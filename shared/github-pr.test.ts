import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveArticleUrl } from "./article.js";
import {
  findPullArticles,
  isPullApiUrl,
  parsePullUrl,
  pickPullArticles,
  pullApiError,
  pullArticleLabel,
  pullArticleUrl,
  pullHead,
  type PullFile,
} from "./github-pr.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("parsePullUrl", () => {
  it("PR の URL を読む(後ろの /files・#・? は無視)", () => {
    for (const url of [
      "https://github.com/o/r/pull/12",
      "https://github.com/o/r/pull/12/",
      "https://github.com/o/r/pull/12/files",
      "https://github.com/o/r/pull/12#issuecomment-1",
      "https://github.com/o/r/pull/12?w=1",
      "  https://github.com/o/r/pull/12  ",
    ]) {
      assert.deepEqual(parsePullUrl(url), { repo: "o/r", number: 12 }, url);
    }
  });

  it("PR の URL でなければ null(今の読み込みに回す)", () => {
    for (const url of [
      "https://github.com/o/r/tree/main/posts/x",
      "https://github.com/o/r/blob/main/posts/x/article.md",
      "https://raw.githubusercontent.com/o/r/main/x/article.md",
      "https://github.com/o/r/pulls",
      "https://github.com/o/r/pull/abc",
      "https://github.com/o/r/pull/0",
      "https://github.com/o/r/pull/12abc",
      "http://github.com/o/r/pull/12",
      "https://example.com/o/r/pull/12",
      "https://github.com/o/../pull/12",
      "not a url",
    ]) {
      assert.equal(parsePullUrl(url), null, url);
    }
  });
});

describe("isPullApiUrl(トークンを付けてよい送り先)", () => {
  it("PR と、その変わったファイルの問い合わせだけ", () => {
    assert.equal(isPullApiUrl("https://api.github.com/repos/o/r/pulls/12"), true);
    assert.equal(isPullApiUrl("https://api.github.com/repos/o/r/pulls/12/files?per_page=100&page=1"), true);
    assert.equal(isPullApiUrl("https://api.github.com/user"), false);
    assert.equal(isPullApiUrl("https://api.github.com/repos/o/r/contents/x"), false);
    assert.equal(isPullApiUrl("https://evil.example/repos/o/r/pulls/12"), false);
    assert.equal(isPullApiUrl("http://api.github.com/repos/o/r/pulls/12"), false);
  });
});

describe("pickPullArticles", () => {
  it("article.md だけを、出てきた順に選ぶ(消したもの・ほかのファイル・大文字の名前は選ばない)", () => {
    const files: PullFile[] = [
      { filename: "posts/a/thumbnail.png", status: "added" },
      { filename: "posts/a/article.md", status: "added" },
      { filename: "posts/b/article.md", status: "modified" },
      { filename: "posts/c/article.md", status: "removed" },
      { filename: "posts/d/Article.md", status: "added" },
      { filename: "posts/e/notes.md", status: "added" },
      { filename: "posts/f/article.md", status: "renamed" },
      { filename: "article.md", status: "added" },
    ];
    assert.deepEqual(pickPullArticles(files), ["posts/a/article.md", "posts/b/article.md", "posts/f/article.md", "article.md"]);
  });
});

describe("pullHead・pullArticleUrl", () => {
  it("最新のコミットの SHA で、PR のブランチのリポジトリ(フォークならそちら)から読む", () => {
    const head = pullHead({ head: { sha: SHA, repo: { full_name: "fork/r" } } });
    assert.deepEqual(head, { repo: "fork/r", sha: SHA });
    const url = pullArticleUrl(head, "posts/日本語 x/article.md");
    assert.equal(url, `https://github.com/fork/r/blob/${SHA}/posts/%E6%97%A5%E6%9C%AC%E8%AA%9E%20x/article.md`);
    // 今の読み込みに渡すと、画像の基準は article.md と同じフォルダ(そのコミット)になる
    assert.deepEqual(resolveArticleUrl(url), {
      mdUrl: `https://raw.githubusercontent.com/fork/r/${SHA}/posts/%E6%97%A5%E6%9C%AC%E8%AA%9E%20x/article.md`,
      baseUrl: `https://raw.githubusercontent.com/fork/r/${SHA}/posts/%E6%97%A5%E6%9C%AC%E8%AA%9E%20x`,
    });
  });

  it("フォークが消えている・SHA が変なら止める", () => {
    assert.throws(() => pullHead({ head: { sha: SHA, repo: null } }), /見つかりません/);
    assert.throws(() => pullHead({ head: { sha: "main", repo: { full_name: "o/r" } } }), /コミット/);
    assert.throws(() => pullHead({ head: { sha: SHA, repo: { full_name: "o/r/../x" } } }), /見つかりません/);
  });

  it("選ぶときの名前は記事のフォルダ", () => {
    assert.equal(pullArticleLabel("posts/2026-11-25-x/article.md"), "posts/2026-11-25-x");
    assert.equal(pullArticleLabel("article.md"), "article.md");
  });
});

describe("findPullArticles", () => {
  const info = { head: { sha: SHA, repo: { full_name: "o/r" } } };
  const fake = (pages: PullFile[][]) => {
    const asked: string[] = [];
    const getJson = async (url: string) => {
      asked.push(url);
      if (url.endsWith("/pulls/7")) return info;
      const page = Number(new URL(url).searchParams.get("page"));
      return pages[page - 1] ?? [];
    };
    return { asked, getJson };
  };

  it("記事が 1 本", async () => {
    const { getJson } = fake([[{ filename: "posts/a/article.md", status: "added" }]]);
    const r = await findPullArticles({ repo: "o/r", number: 7 }, getJson);
    assert.deepEqual(r.articles, [{ filename: "posts/a/article.md", label: "posts/a", url: `https://github.com/o/r/blob/${SHA}/posts/a/article.md` }]);
  });

  it("変わったファイルが 100 を超えたら次のページも読む", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ filename: `img/${i}.png`, status: "added" }));
    const { asked, getJson } = fake([many, [{ filename: "posts/b/article.md", status: "modified" }]]);
    const r = await findPullArticles({ repo: "o/r", number: 7 }, getJson);
    assert.deepEqual(r.articles.map((a) => a.label), ["posts/b"]);
    assert.equal(asked.length, 3);
    for (const url of asked) assert.ok(isPullApiUrl(url), url);
  });

  it("記事が無ければ止める", async () => {
    const { getJson } = fake([[{ filename: "README.md", status: "modified" }]]);
    await assert.rejects(findPullArticles({ repo: "o/r", number: 7 }, getJson), /記事\(article\.md\)がありません/);
  });
});

describe("pullApiError", () => {
  const ref = { repo: "o/r", number: 7 };
  it("回数の上限・見つからない・トークンが使えない", () => {
    assert.match(pullApiError(403, ref, true), /回数の上限/);
    assert.match(pullApiError(404, ref, false), /見つかりません.*トークン/);
    assert.match(pullApiError(401, ref, false), /トークンが使えません/);
    // 回数の上限でない 403 は、PR を読む権限が足りないとき
    assert.match(pullApiError(403, ref, false), /o\/r#7.*Pull requests: Read/);
    assert.doesNotMatch(pullApiError(403, ref, false), /回数の上限/);
    assert.match(pullApiError(500, ref, false), /500/);
  });
});
