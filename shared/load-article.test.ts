import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { loadArticle } from "../tools/lib/article.js";

const INPUT = "https://github.com/owner/repo/tree/main/posts/example";
const BASE = "https://raw.githubusercontent.com/owner/repo/main/posts/example";
const MD_URL = `${BASE}/article.md`;
const TEST_TOKEN = "load-article-test-token";
const IMAGE_BYTES = new Uint8Array([1, 2, 3]);

type FetchCall = { url: string; hasAuthorization: boolean };

function mockRequests(t: TestContext, options: { thumbnail: string; token?: string; contentType?: string }): FetchCall[] {
  const originalToken = process.env.GITHUB_TOKEN;
  t.after(() => {
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  });
  if (options.token === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = options.token;

  const markdown = [
    "---",
    "title: テストのタイトル",
    "hashtags: [AI, テスト]",
    "magazine: テストのマガジン",
    `thumbnail: ${options.thumbnail}`,
    "---",
    "",
    "本文 **太字**",
  ].join("\n");
  const thumbnailUrl = new URL(options.thumbnail, `${BASE}/`).toString();
  const calls: FetchCall[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push({ url: request.url, hasAuthorization: request.headers.has("Authorization") });
    if (request.url === MD_URL) return new Response(markdown);
    if (request.url === thumbnailUrl) {
      return new Response(IMAGE_BYTES, {
        headers: options.contentType ? { "Content-Type": options.contentType } : {},
      });
    }
    assert.fail(`想定外の fetch: ${request.url}`);
  });
  return calls;
}

describe("loadArticle のリクエストと取得結果", { concurrency: false }, () => {
  it("記事と同じリポジトリの相対パスの画像だけにトークンを付け、front matter と応答を返す", async (t) => {
    const calls = mockRequests(t, { thumbnail: "./thumbnail.png", token: TEST_TOKEN, contentType: "image/webp" });
    const article = await loadArticle(INPUT);

    assert.deepEqual(calls, [
      { url: MD_URL, hasAuthorization: true },
      { url: `${BASE}/thumbnail.png`, hasAuthorization: true },
    ]);
    assert.equal(article.title, "テストのタイトル");
    assert.deepEqual(article.hashtags, ["AI", "テスト"]);
    assert.equal(article.magazine, "テストのマガジン");
    assert.match(article.html, /<strong>太字<\/strong>/);
    assert.deepEqual(article.thumbnail, {
      name: "thumbnail.png",
      mimeType: "image/webp",
      buffer: Buffer.from(IMAGE_BYTES),
    });
  });

  it("同じ owner/repo の絶対 URL は、別ブランチの画像でもトークンを付ける", async (t) => {
    const thumbnail = "https://raw.githubusercontent.com/owner/repo/images/cover.jpg";
    const calls = mockRequests(t, { thumbnail, token: TEST_TOKEN });
    await loadArticle(INPUT);
    assert.deepEqual(calls, [
      { url: MD_URL, hasAuthorization: true },
      { url: thumbnail, hasAuthorization: true },
    ]);
  });

  for (const [name, thumbnail] of [
    ["owner が違う", "https://raw.githubusercontent.com/other/repo/main/cover.png"],
    ["repo が違う", "https://raw.githubusercontent.com/owner/other/main/cover.png"],
  ]) {
    it(`${name}画像は取得するが、トークンは付けない`, async (t) => {
      const calls = mockRequests(t, { thumbnail, token: TEST_TOKEN });
      await loadArticle(INPUT);
      assert.deepEqual(calls, [
        { url: MD_URL, hasAuthorization: true },
        { url: thumbnail, hasAuthorization: false },
      ]);
    });
  }

  it("raw.githubusercontent.com 以外の画像は失敗し、そのホストへ fetch しない", async (t) => {
    const calls = mockRequests(t, { thumbnail: "https://example.com/cover.png", token: TEST_TOKEN });
    await assert.rejects(() => loadArticle(INPUT), /raw\.githubusercontent\.com 以外の URL は取りに行きません/);
    assert.deepEqual(calls, [{ url: MD_URL, hasAuthorization: true }]);
  });

  for (const thumbnail of [`${BASE}/thumbnail.png`, "https://raw.githubusercontent.com/other/repo/main/cover.png"]) {
    it(`トークンが無ければ記事にも画像にも認証ヘッダーを付けない: ${thumbnail}`, async (t) => {
      const calls = mockRequests(t, { thumbnail });
      await loadArticle(INPUT);
      assert.deepEqual(calls, [
        { url: MD_URL, hasAuthorization: false },
        { url: thumbnail, hasAuthorization: false },
      ]);
    });
  }

  for (const [name, mimeType] of [
    ["cover.png", "image/png"],
    ["cover.JPG", "image/jpeg"],
    ["cover.jpeg", "image/jpeg"],
    ["cover.webp", "image/webp"],
    ["cover.gif", "image/gif"],
    ["cover.bin", "application/octet-stream"],
  ]) {
    it(`content-type が無ければ ${name} の拡張子から MIME type を決める`, async (t) => {
      mockRequests(t, { thumbnail: `./${name}`, token: TEST_TOKEN });
      const article = await loadArticle(INPUT);
      assert.deepEqual(article.thumbnail, { name, mimeType, buffer: Buffer.from(IMAGE_BYTES) });
    });
  }
});
