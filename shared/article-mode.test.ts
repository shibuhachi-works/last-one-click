import assert from "node:assert/strict";
import { it } from "node:test";
import { articleMode } from "./article-mode.js";
import { resolveArticleModes } from "../tools/lib/article-modes.js";

it("ラベルの優先順は skip > hold > save、無ければ既定の動き", () => {
  assert.equal(articleMode([], "hold"), "hold");
  assert.equal(articleMode(["other"], "save"), "save");
  assert.equal(articleMode(["auto-draft:save"], "hold"), "save");
  assert.equal(articleMode(["auto-draft:save", "auto-draft:hold"], "save"), "hold");
  assert.equal(articleMode(["auto-draft:save", "auto-draft:hold", "auto-draft:skip"], "save"), "skip");
});

const commit = "c".repeat(40);
it("コミット・ファイル・PR の次ページも調べ、未マージの PR は使わない", async () => {
  const calls: string[] = [];
  const plan = await resolveArticleModes(async (url) => {
    calls.push(url);
    const page = Number(new URL(`https://example.test${url}`).searchParams.get("page"));
    if (url.includes("/compare/")) return {
      total_commits: 101,
      commits: page === 1 ? Array.from({ length: 100 }, () => ({ sha: "d".repeat(40) })) : [{ sha: commit }],
    };
    if (url.includes("/pulls?")) return page === 1
      ? Array.from({ length: 100 }, () => ({ number: 1, merged_at: null, labels: [{ name: "auto-draft:skip" }] }))
      : [{ number: 2, merged_at: "2026-01-01", labels: [{ name: "auto-draft:hold" }] }];
    return { files: page === 1
      ? Array.from({ length: 100 }, (_, i) => ({ filename: `unrelated/${i}`, status: "modified" }))
      : [{ filename: "posts/a/article.md", status: "added" }] };
  }, "owner/repo", "a".repeat(40), "b".repeat(40), ["posts/a"], "save");
  assert.equal(plan.get("posts/a")?.mode, "hold");
  assert.equal(calls.length, 6);
});

it("追加コミットが不明な場合・壊れた PR 応答では既定モードへ進まない", async () => {
  for (const files of [[], [{ filename: "posts/a/article.md", status: "added" }]]) {
    await assert.rejects(resolveArticleModes(async (url) => {
      if (url.includes("/compare/")) return { total_commits: 1, commits: [{ sha: commit }] };
      if (url.includes("/pulls?")) return [{ number: 1, merged_at: "2026-01-01" }];
      return { files };
    }, "owner/repo", "a".repeat(40), "b".repeat(40), ["posts/a"], "save"));
  }
});
