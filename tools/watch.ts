// 見張り役。記事のリポジトリに「新しく足された記事」があれば、note の下書きを作って保存する。
// 手元の PC(Debian などの Linux のデスクトップ)で数分おきに動かす前提(docs/auto-draft-linux.md)。公開はしない。
//
//   LOC_WATCH_REPO=owner/repo LOC_WATCH_PREFIX=posts/ npm run watch
//
// 環境変数:
//   LOC_WATCH_REPO    記事のリポジトリ(owner/repo)。必須
//   LOC_WATCH_PREFIX  見張るフォルダ(例 posts/)。必須。この下に足された article.md だけを下書きにする
//   LOC_WATCH_BRANCH  見張るブランチ。既定 main
//   GITHUB_TOKEN      private リポジトリを読むときだけ(読み取り専用のものを使う)
//   LOC_WATCH_MODE    save(既定): 下書き保存して窓を閉じる。
//                     hold: 下書き保存のあと、公開設定(ハッシュタグ・マガジン)まで入れて、窓を開いたまま待つ。
//                     人がリモートデスクトップなどで確かめて「投稿する」を押し、窓を閉じると次の記事へ進む
//   LOC_WATCH_REMOTE_URL 待つモードの通知(Webhook)に付ける、リモートデスクトップのリンク(rdp:// か https://)
//   LOC_WATCH_DRY_RUN 1 にすると、選んだ記事を表示するだけ。下書きは作らず、.watch-state.json も書き換えない(設定の確認用)
//
// 動き:
// - 1 回目は、いまの main の位置を覚えるだけ(過去の記事をまとめて下書きにしない)
// - 2 回目からは、覚えた位置から main の先頭までに「足された」article.md を探し、1 本ずつ
//   `tools/draft.ts --save` で下書きにする。記事の手直し(変更)・削除・名前の変更では作らない
// - 全部うまくいったら位置を進める。途中で失敗したら位置は進めず、うまくいった記事だけ覚えておく
//   (次の回で、失敗した記事からやり直す。同じ記事の下書きを二度は作らない)
// - note のメンテナンス中(draft.ts の終了コード 3)は、通知を出さずに、位置も進めずに終わる(次の回でやり直す)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { notify } from "./lib/notify.js";
import { articleTreeUrl, isBranchName, isRepoName, normalizePrefix, pickNewArticleDirs, type ChangedFile } from "../shared/new-articles.js";

const STATE_FILE = path.resolve(process.cwd(), ".watch-state.json");
/** 下書き保存が済んだ記事の印(draft.ts が作る)。待っている間に止まっても、同じ記事を作り直さないため */
const SAVED_DIR = path.resolve(process.cwd(), ".watch-saved");

type State = { repo: string; branch: string; lastSha: string; done: string[] };

const repo = process.env.LOC_WATCH_REPO ?? "";
const branch = process.env.LOC_WATCH_BRANCH || "main";
const prefixRaw = process.env.LOC_WATCH_PREFIX ?? "";

if (!isRepoName(repo)) fail("LOC_WATCH_REPO に owner/repo を入れてください。");
if (!isBranchName(branch)) fail(`LOC_WATCH_BRANCH が不正です: ${branch}`);
let prefix: string;
try {
  prefix = normalizePrefix(prefixRaw);
} catch (e) {
  fail(`LOC_WATCH_PREFIX: ${(e as Error).message}`);
}

const DRY_RUN = process.env.LOC_WATCH_DRY_RUN === "1";
const MODE = process.env.LOC_WATCH_MODE || "save";
if (MODE !== "save" && MODE !== "hold") fail(`LOC_WATCH_MODE は save か hold にしてください: ${MODE}`);
const head = await headSha();
const state = readState();

if (!state || state.repo !== repo || state.branch !== branch) {
  if (DRY_RUN) {
    log(`まだ見張りを始めていません。DRY_RUN なので位置は覚えずに終わります(いまの位置 ${head.slice(0, 7)})。`);
    process.exit(0);
  }
  writeState({ repo, branch, lastSha: head, done: [] });
  log(`見張りを始めました(${repo} の ${branch}、${prefix} の下)。いまの位置 ${head.slice(0, 7)} から後に足された記事を下書きにします。`);
  process.exit(0);
}
if (state.lastSha === head) {
  log("新しいコミットはありません。");
  process.exit(0);
}

const files = await compareFiles(state.lastSha, head);
// この範囲で足された記事すべて(前の回で処理済みのものも含む)。位置を進めるときに、これら全部の印を消す
const allDirs = pickNewArticleDirs(files, prefix);
const dirs = allDirs.filter((d) => !state.done.includes(d));
if (dirs.length === 0) {
  // DRY_RUN(設定の確認)では位置を進めない。違う prefix で試したときに、記事を取りこぼさないように
  if (!DRY_RUN) {
    writeState({ ...state, lastSha: head, done: [] });
    clearMarkers(allDirs);
  }
  log(`新しい記事はありません(${state.lastSha.slice(0, 7)}..${head.slice(0, 7)})。`);
  process.exit(0);
}

log(`新しい記事 ${dirs.length} 本: ${dirs.join(", ")}`);
if (DRY_RUN) {
  log("LOC_WATCH_DRY_RUN=1 なので、下書きは作らずに終わります。");
  process.exit(0);
}
for (const dir of dirs) {
  const url = articleTreeUrl(repo, head, dir);
  const marker = savedMarker(dir);
  // 前の回で下書き保存まで済んでいた記事(待っている間に PC が止まった、など)は、作り直さない
  if (existsSync(marker)) {
    log(`前の回で下書き保存まで済んでいるので、作り直しません: ${dir}`);
    markDone(dir);
    continue;
  }
  log(`下書きを作ります: ${dir}`);
  // シェルは通さない(引数はそのまま渡す)。下書き保存が済んだら draft.ts が marker のファイルを作る
  const r = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "tools/draft.ts", `--${MODE}`, url], {
    stdio: "inherit",
    env: { ...process.env, LOC_SAVED_MARKER: marker },
  });
  if (r.status === 0) {
    markDone(dir);
    // hold は、人が窓を閉じたあとに戻ってくる(待っている間の通知は draft.ts が出す)
    if (MODE === "save") await notify("下書きが完了しました", `${baseName(dir)}。note の「下書き」から確かめて、公開してください。`);
    continue;
  }
  if (existsSync(marker)) {
    // 下書き保存のあとで失敗した(hold の公開設定など)。下書きはあるので、作り直さずに次へ進む
    markDone(dir);
    await notify("下書きは保存しましたが、途中で止まりました", `${baseName(dir)}。note の「下書き」から開いて、公開設定を入れてください。`);
    continue;
  }
  if (r.status === 3) {
    // note のメンテナンス中。通知は出さず(終わるまで 5 分ごとに鳴るのを避ける)、位置も進めずに、次の回でやり直す
    log(`note がメンテナンス中なので、この回は止めます。次の回でやり直します: ${dir}`);
    process.exit(0);
  }
  if (r.status === 2) {
    await notify("note にログインしていません", "`npm run login` を実行してから、もう一度動かしてください。");
    fail("note にログインしていないので止めます。");
  }
  await notify("下書きを作れませんでした", `${baseName(dir)}。ログを確かめてください。次の回でやり直します。`);
  fail(`下書きを作れませんでした: ${dir}`);
}
writeState({ ...state, lastSha: head, done: [] });
// 位置を進めたので、この範囲の記事の marker はもう要らない
clearMarkers(allDirs);
log("全部の記事を下書きにしました。");

// ---------------------------------------------------------------------------

async function gh(pathAndQuery: string): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${pathAndQuery}`, { headers });
  if (!res.ok) fail(`GitHub API ${res.status} ${res.statusText}: ${pathAndQuery}`);
  return res.json();
}

async function headSha(): Promise<string> {
  const j = (await gh(`/repos/${repo}/commits/${encodeURIComponent(branch)}`)) as { sha?: unknown };
  if (typeof j.sha !== "string" || !/^[0-9a-f]{40}$/.test(j.sha)) fail("ブランチの先頭のコミットが読めません。");
  return j.sha;
}

async function compareFiles(base: string, to: string): Promise<ChangedFile[]> {
  const j = (await gh(`/repos/${repo}/compare/${base}...${to}`)) as { files?: Array<{ filename?: unknown; status?: unknown }> };
  const files = (j.files ?? []).flatMap((f) => (typeof f.filename === "string" && typeof f.status === "string" ? [{ filename: f.filename, status: f.status }] : []));
  // compare API は 300 ファイルまでしか返さない。超えたら取りこぼすので、知らせて止める
  if (files.length >= 300) fail("変更されたファイルが多すぎて、新しい記事を選べません(300 以上)。.watch-state.json の lastSha を進めてやり直してください。");
  return files;
}

function readState(): State | undefined {
  if (!existsSync(STATE_FILE)) return undefined;
  const s = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<State>;
  if (typeof s.lastSha !== "string" || !/^[0-9a-f]{40}$/.test(s.lastSha)) return undefined;
  return { repo: String(s.repo ?? ""), branch: String(s.branch ?? ""), lastSha: s.lastSha, done: Array.isArray(s.done) ? s.done.map(String) : [] };
}

function writeState(s: State) {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n");
}

/**
 * 記事ごとの印のファイル。名前はリポジトリ・ブランチ・フォルダのハッシュ(長さが決まっている)。
 * 見張る先を変えても前の印を取り違えず、日本語の長いフォルダ名でもファイル名の上限を超えない
 */
function savedMarker(dir: string): string {
  const key = createHash("sha256").update(`${repo}\n${branch}\n${dir}`).digest("hex");
  return path.join(SAVED_DIR, key);
}

/**
 * 位置を進めたあと、その範囲の記事の印を消す(前の回で処理済みになった記事の分も)。
 * 残すと、同じパスに別の記事が足されたときに「保存済み」と取り違える
 */
function clearMarkers(dirs: readonly string[]) {
  for (const dir of dirs) rmSync(savedMarker(dir), { force: true });
}

function markDone(dir: string) {
  if (!state) return;
  state.done.push(dir);
  writeState(state);
}

function baseName(dir: string): string {
  return dir.slice(dir.lastIndexOf("/") + 1);
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[${new Date().toISOString()}] ${msg}`);
  process.exit(1);
}
