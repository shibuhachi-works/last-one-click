import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Marked } from "marked";
import { parse as parseYaml } from "yaml";
import { renderArticle } from "./article.js";
import { CREDIT_HTML, CREDIT_MARKDOWN, CREDIT_URL, appendCreditHtml } from "./credit.js";
import { SAFE_RENDERER } from "./markdown-safe.js";

const md = new Marked({ gfm: true, breaks: true, renderer: SAFE_RENDERER as never });
const render = (s: string) => renderArticle(s, { markdown: (b) => md.parse(b) as string, yaml: parseYaml });
/** 拡張と同じ順番: md を HTML にしてから、リンクを足す */
const build = async (s: string, enabled: boolean) => {
  const a = await render(s);
  return { ...a, html: appendCreditHtml(a.html, enabled) };
};

describe("appendCreditHtml", () => {
  it("enabled: true で、本文の最後に区切り線と 1 行が付く。リンク先はストアの URL", async () => {
    const a = await build("---\ntitle: t\n---\n\n## 見出し\n\n本文です。\n", true);
    assert.ok(a.html.startsWith("<h2>見出し</h2>"), a.html);
    assert.ok(a.html.endsWith(`<hr>\n<p>この記事は、<a href="${CREDIT_URL}">Last One Click</a> で下書きしました。</p>\n`), a.html);
    assert.equal(CREDIT_URL, "https://chromewebstore.google.com/detail/last-one-click/jomapffkhcdpnodaffobmpfofnnaihnd");
  });

  it("enabled: false で、本文がまったく変わらない", () => {
    for (const html of ["", "<p>本文</p>\n", "<h2>a</h2>\n\n"]) assert.equal(appendCreditHtml(html, false), html);
  });

  it("足す HTML は、同じ中身を md で書いて marked(SAFE_RENDERER)で変換したものと同じ", () => {
    assert.equal(md.parse(CREDIT_MARKDOWN) as string, CREDIT_HTML);
  });

  it("front matter の読み取り結果が変わらない(md には手を入れない)", async () => {
    const src = "---\ntitle: タイトル\nhashtags: [a, b]\nmagazine: マガジン\nthumbnail: ./thumbnail.png\n---\n\n## 見出し\n\n本文です。\n";
    const before = await render(src);
    const after = await build(src, true);
    assert.equal(after.title, before.title);
    assert.deepEqual(after.hashtags, before.hashtags);
    assert.equal(after.magazine, before.magazine);
    assert.equal(after.thumbnail, before.thumbnail);
  });

  it("本文の最後に改行が無くても、区切り線が直前の段落とつながらない(見出しにならない)", async () => {
    const a = await build("---\ntitle: t\n---\n\n最後の段落", true);
    assert.ok(a.html.includes("<p>最後の段落</p>"), a.html);
    assert.ok(!a.html.includes("<h2>最後の段落</h2>"), a.html);
    assert.ok(a.html.includes("<hr>"), a.html);
  });
});

describe("記事の書き方に影響されない(Codex の指摘)", () => {
  it("記事の最後が閉じていないコードブロックでも、リンクはコードの外に入る", async () => {
    const a = await build("---\ntitle: t\n---\n\n```\nconst a = 1;\n", true);
    assert.ok(a.html.includes(`<a href="${CREDIT_URL}">Last One Click</a>`), a.html);
    const pre = a.html.lastIndexOf("</pre>");
    assert.ok(pre >= 0 && a.html.indexOf("下書きしました") > pre, a.html);
    assert.ok(!a.html.slice(0, pre).includes("下書きしました"), a.html);
  });

  it("front matter が無く先頭が --- の記事でも、本文が消えない", async () => {
    const a = await build("---\n# タイトル\n\n本文です。\n", true);
    assert.ok(a.html.includes("本文です。"), a.html);
    assert.ok(a.html.includes("下書きしました"), a.html);
  });
});
