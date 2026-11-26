// GitHub の PR の URL から記事を読む(#172)。拡張と Playwright 版で共通の、通信しない判断だけを置く。
//
// 流れ: PR の URL → API で PR(最新のコミットの SHA・どのリポジトリのブランチか)と変わったファイルを読む
// → 変わった article.md を選ぶ → そのコミットの raw URL で読む(ブランチ名では読まない。押した時点の中身にする)。
// API(api.github.com)は CORS がどこからでも開いているので、拡張の権限は増やさない。

export const API_HOST = "api.github.com";

/** 1 回で読む変わったファイルの数(API の上限)と、読むページの数の上限 */
export const FILES_PER_PAGE = 100;
export const MAX_FILE_PAGES = 10;

export type PullRef = { repo: string; number: number };

const NAME = /^[A-Za-z0-9_.-]+$/;

/** `https://github.com/<owner>/<repo>/pull/<番号>`(後ろに /files や #… が付いてもよい)なら読む。PR の URL でなければ null */
export function parsePullUrl(input: string): PullRef | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "github.com") return null;
  const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/[^]*)?$/);
  if (!m) return null;
  const [, owner, repo, num] = m;
  if (!NAME.test(owner) || !NAME.test(repo) || [owner, repo].some((p) => p === "." || p === "..")) return null;
  const number = Number(num);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { repo: `${owner}/${repo}`, number };
}

export function pullApiUrl(ref: PullRef): string {
  return `https://${API_HOST}/repos/${ref.repo}/pulls/${ref.number}`;
}

export function pullFilesApiUrl(ref: PullRef, page: number): string {
  return `${pullApiUrl(ref)}/files?per_page=${FILES_PER_PAGE}&page=${page}`;
}

/** 送り先が API の PR の問い合わせか(トークンを付けてよいのはここだけ) */
export function isPullApiUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && u.hostname === API_HOST && /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+(\/files)?$/.test(u.pathname);
}

/** API の PR のうち、使う項目だけ */
export type PullInfo = { head: { sha: string; repo: { full_name: string } | null } };
/** API の変わったファイルのうち、使う項目だけ */
export type PullFile = { filename: string; status: string };

/** 記事のファイルか(フォルダの中の `article.md`。小文字だけ。フォルダの URL で読むときと同じ名前) */
function isArticleFile(filename: string): boolean {
  return filename === "article.md" || filename.endsWith("/article.md");
}

/** 変わったファイルから、読める記事(消したものは除く)を出てきた順に選ぶ */
export function pickPullArticles(files: readonly PullFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (f.status === "removed") continue;
    if (!isArticleFile(f.filename)) continue;
    if (!out.includes(f.filename)) out.push(f.filename);
  }
  return out;
}

/** PR の最新のコミットの、どのリポジトリから読むか。消されたフォークなど、読めなければエラー */
export function pullHead(info: PullInfo): { repo: string; sha: string } {
  const repo = info?.head?.repo?.full_name ?? "";
  const sha = info?.head?.sha ?? "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("この PR のブランチがあるリポジトリが見つかりません(消されたフォークなど)。");
  }
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("この PR の最新のコミットが読めませんでした。");
  return { repo, sha };
}

/** 記事の GitHub の URL(そのコミットの blob)。今の読み込み(resolveArticleUrl)にそのまま渡せる */
export function pullArticleUrl(head: { repo: string; sha: string }, filename: string): string {
  const path = filename.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${head.repo}/blob/${head.sha}/${path}`;
}

/** 選ぶときに出す名前(記事のフォルダ。リポジトリの直下なら article.md) */
export function pullArticleLabel(filename: string): string {
  const i = filename.lastIndexOf("/");
  return i < 0 ? filename : filename.slice(0, i);
}

/** API を 1 回読む(拡張は fetch とトークン、テストは差し替え)。読めなければエラーを投げる */
export type GetJson = (url: string) => Promise<unknown>;

/**
 * PR の記事を探す。返すのは、読む元(最新のコミット)と、記事の GitHub の URL の一覧(変わった順)。
 * 記事が無ければエラー
 */
export async function findPullArticles(
  ref: PullRef,
  getJson: GetJson,
): Promise<{ head: { repo: string; sha: string }; articles: { filename: string; label: string; url: string }[] }> {
  const head = pullHead((await getJson(pullApiUrl(ref))) as PullInfo);
  const files: PullFile[] = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const got = await getJson(pullFilesApiUrl(ref, page));
    if (!Array.isArray(got)) throw new Error("この PR の変わったファイルが読めませんでした。");
    files.push(...(got as PullFile[]));
    if (got.length < FILES_PER_PAGE) break;
  }
  const names = pickPullArticles(files);
  if (names.length === 0) throw new Error(`この PR には記事(article.md)がありません: ${ref.repo}#${ref.number}`);
  return { head, articles: names.map((filename) => ({ filename, label: pullArticleLabel(filename), url: pullArticleUrl(head, filename) })) };
}

/** API が返した失敗を、読む人向けの文にする */
export function pullApiError(status: number, ref: PullRef, rateLimited: boolean): string {
  if (rateLimited) return "GitHub の API の回数の上限に達しました。しばらく待つか、GitHub トークンを入れてください。";
  if (status === 404) return `PR が見つかりません: ${ref.repo}#${ref.number}(非公開のリポジトリなら、GitHub トークンを入れてください)`;
  if (status === 401) return "GitHub トークンが使えません。設定のトークンを確かめてください。";
  // トークンは通ったが、PR を読む権限が無い(記事を読む「Contents: Read」だけのトークンなど)。回数の上限は上で別に知らせる
  if (status === 403) {
    return `GitHub トークンで、この PR を読めません: ${ref.repo}#${ref.number}。PR を読むには、トークンに「Pull requests: Read」の権限が要ります。Fine-grained トークンなら、GitHub の Settings → Developer settings → Personal access tokens でトークンを開き、Repository permissions の Pull requests を Read-only にしてください(トークンを入れ直す必要はありません)。`;
  }
  return `PR を読めませんでした(${status}): ${ref.repo}#${ref.number}`;
}
