import { articleMode, type ArticleMode, type DraftMode } from "../../shared/article-mode.js";

type GitHub = (path: string) => Promise<unknown>;
type Plan = { mode: ArticleMode; prs: number[]; labels: string[] };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("GitHub API の応答が不正です。");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("GitHub API の一覧が読めません。");
  return value;
}
function sha(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) throw new Error("コミットの SHA が読めません。");
  return value;
}

/** 全記事のラベルを先に取得する。途中で失敗したら、下書き作成・位置の更新へ進ませない。 */
export async function resolveArticleModes(
  gh: GitHub, repo: string, base: string, head: string, dirs: readonly string[], fallback: DraftMode,
): Promise<Map<string, Plan>> {
  const root = `/repos/${repo}`;
  const commits: string[] = [];
  for (let page = 1; ; page++) {
    const data = object(await gh(`${root}/compare/${base}...${head}?per_page=100&page=${page}`));
    const batch = array(data.commits).map((c) => sha(object(c).sha));
    if (!Number.isSafeInteger(data.total_commits) || (data.total_commits as number) < 0) throw new Error("コミット数が読めません。");
    commits.push(...batch);
    if (commits.length === data.total_commits) break;
    if (batch.length === 0 || commits.length > (data.total_commits as number)) throw new Error("コミット一覧が不完全です。");
  }

  const pending = new Set(dirs);
  const result = new Map<string, Plan>();
  // 同じパスが削除・再追加された場合は、最後の追加を使う。
  for (const commit of commits.reverse()) {
    if (!pending.size) break;
    const added = new Set<string>();
    for (let page = 1; ; page++) {
      const data = object(await gh(`${root}/commits/${commit}?per_page=100&page=${page}`));
      const files = array(data.files);
      for (const raw of files) {
        const file = object(raw);
        if (typeof file.filename !== "string" || typeof file.status !== "string") throw new Error("変更ファイルが読めません。");
        if (file.status === "added") added.add(file.filename);
      }
      if (files.length < 100) break;
      // コミット API は最大 3000 ファイル。上限で打ち切られたときは推測しない。
      if (page >= 30) throw new Error("コミットの変更ファイルが多すぎます。");
    }
    const matching = [...pending].filter((dir) => added.has(`${dir}/article.md`));
    if (!matching.length) continue;
    const labels: string[] = [];
    const prs: number[] = [];
    for (let page = 1; ; page++) {
      const pulls = array(await gh(`${root}/commits/${commit}/pulls?per_page=100&page=${page}`));
      for (const raw of pulls) {
        const pr = object(raw);
        if (pr.merged_at === null) continue;
        if (typeof pr.merged_at !== "string" || !Number.isSafeInteger(pr.number)) throw new Error("PR のマージ情報が読めません。");
        prs.push(pr.number as number);
        for (const rawLabel of array(pr.labels)) {
          const label = object(rawLabel).name;
          if (typeof label !== "string") throw new Error("PR のラベルが読めません。");
          // ログに残すのは動きに関係する固定のラベルだけ。
          if (["auto-draft:skip", "auto-draft:hold", "auto-draft:save"].includes(label)) labels.push(label);
        }
      }
      if (pulls.length < 100) break;
    }
    const plan = { mode: articleMode(labels, fallback), prs, labels: [...new Set(labels)] };
    for (const dir of matching) {
      result.set(dir, plan);
      pending.delete(dir);
    }
  }
  if (pending.size) throw new Error("記事を追加したコミットが見つかりません。位置は進めず、次の回でやり直します。");
  return result;
}
