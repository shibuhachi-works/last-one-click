import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { articleTreeUrl, isBranchName, isRepoName, normalizePrefix, pickNewArticleDirs } from "./new-articles.js";

describe("pickNewArticleDirs", () => {
  it("prefix の下に足された article.md のフォルダだけを選ぶ", () => {
    const files = [
      { filename: "posts/dev/2026-11-12-a/article.md", status: "added" },
      { filename: "posts/dev/2026-11-12-a/thumbnail.png", status: "added" },
      { filename: "posts/dev/2026-11-01-old/article.md", status: "modified" },
      { filename: "posts/dev/2026-11-02-moved/article.md", status: "renamed" },
      { filename: "posts/dev/2026-11-03-gone/article.md", status: "removed" },
      { filename: "library/2026-11-12-b/article.md", status: "added" },
      { filename: "posts/health/2026-11-12-c/Article.md", status: "added" },
      { filename: "posts/README.md", status: "added" },
    ];
    assert.deepEqual(pickNewArticleDirs(files, "posts/"), ["posts/dev/2026-11-12-a", "posts/health/2026-11-12-c"]);
  });
  it("prefix の書き方の揺れ(先頭の ./ や末尾の / なし)を許す", () => {
    const files = [{ filename: "posts/x/article.md", status: "added" }];
    assert.deepEqual(pickNewArticleDirs(files, "./posts"), ["posts/x"]);
  });
  it("prefix と名前の先頭だけ同じ別フォルダは選ばない", () => {
    assert.deepEqual(pickNewArticleDirs([{ filename: "posts-old/x/article.md", status: "added" }], "posts"), []);
  });
});

describe("normalizePrefix", () => {
  it("空・.. を含むものはエラー", () => {
    assert.throws(() => normalizePrefix(""));
    assert.throws(() => normalizePrefix("/"));
    assert.throws(() => normalizePrefix("posts/../x"));
  });
});

describe("isRepoName / isBranchName", () => {
  it("owner/repo の形だけを通す", () => {
    assert.equal(isRepoName("owner/repo"), true);
    assert.equal(isRepoName("owner/repo.name-1_x"), true);
    assert.equal(isRepoName("owner"), false);
    assert.equal(isRepoName("owner/repo/x"), false);
    assert.equal(isRepoName("owner/../x"), false);
    assert.equal(isRepoName("owner/re po"), false);
  });
  it("ブランチ名", () => {
    assert.equal(isBranchName("main"), true);
    assert.equal(isBranchName("release/v1"), true);
    assert.equal(isBranchName("-x"), false);
    assert.equal(isBranchName("a..b"), false);
    assert.equal(isBranchName("a b"), false);
  });
});

describe("articleTreeUrl", () => {
  it("SHA を ref にした tree URL を作る(日本語のフォルダ名はエンコード)", () => {
    assert.equal(
      articleTreeUrl("owner/repo", "abc123", "posts/dev/2026-11-12-記事"),
      "https://github.com/owner/repo/tree/abc123/posts/dev/2026-11-12-%E8%A8%98%E4%BA%8B",
    );
  });
  it("owner/repo の形でなければエラー", () => {
    assert.throws(() => articleTreeUrl("https://evil.example/x", "abc", "posts/a"));
  });
});
