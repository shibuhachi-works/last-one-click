// 見張り役(tools/watch.ts)が使う、ブラウザに触らない判断だけを集めたもの。
// 「マージで新しく足された記事」を GitHub の compare API の結果から選ぶ。

/** compare API の files[] のうち、使う項目だけ */
export type ChangedFile = { filename: string; status: string };

/** owner/repo の形か(英数・`-`・`_`・`.` だけ)。URL や引数に混ぜる前に確かめる */
export function isRepoName(s: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s) && !s.split("/").some((p) => p === "." || p === "..");
}

/** ブランチ名として安全か(英数・`-`・`_`・`.`・`/`。`..` や先頭の `-` は不可) */
export function isBranchName(s: string): boolean {
  return /^[A-Za-z0-9_./-]+$/.test(s) && !s.startsWith("-") && !s.includes("..") && !s.startsWith("/") && !s.endsWith("/");
}

/**
 * 対象のフォルダの前置き(例 "posts/")を正規化する。空は不可(リポジトリ全体を見張らない)。
 * 先頭の "/" と "./" は外し、末尾は必ず "/" にする
 */
export function normalizePrefix(prefix: string): string {
  const p = prefix.trim().replace(/^\.?\/+/, "");
  if (!p || p.includes("..")) throw new Error(`見張るフォルダの指定が不正です: "${prefix}"`);
  return p.endsWith("/") ? p : `${p}/`;
}

/**
 * 新しく「足された」記事のフォルダを選ぶ(手直し・名前の変更・削除は選ばない)。
 * 記事は `<prefix>…/article.md`(小文字だけ。tools/draft.ts はフォルダの URL に article.md を付けて読むため、
 * Article.md などを選ぶと読めずに毎回失敗する)。返すのはフォルダのパス(重複なし・出てきた順)
 */
export function pickNewArticleDirs(files: readonly ChangedFile[], prefix: string): string[] {
  const p = normalizePrefix(prefix);
  const out: string[] = [];
  for (const f of files) {
    if (f.status !== "added") continue;
    if (!f.filename.startsWith(p)) continue;
    if (!/(^|\/)article\.md$/.test(f.filename)) continue;
    const dir = f.filename.slice(0, f.filename.lastIndexOf("/"));
    if (dir && !out.includes(dir)) out.push(dir);
  }
  return out;
}

/** 記事フォルダの GitHub の URL(tools/draft.ts に渡す)。ref はコミットの SHA にして、マージした時点の中身を読む */
export function articleTreeUrl(repo: string, ref: string, dir: string): string {
  if (!isRepoName(repo)) throw new Error(`owner/repo の形ではありません: ${repo}`);
  const path = dir.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repo}/tree/${encodeURIComponent(ref)}/${path}`;
}
