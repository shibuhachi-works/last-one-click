import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Marked } from "marked";
import { parse as parseYaml } from "yaml";
import { renderArticle } from "./article.js";
import { CREDIT_URL, appendCredit } from "./credit.js";
import { SAFE_RENDERER } from "./markdown-safe.js";

const md = new Marked({ gfm: true, breaks: true, renderer: SAFE_RENDERER as never });
const render = (s: string) => renderArticle(s, { markdown: (b) => md.parse(b) as string, yaml: parseYaml });

describe("appendCredit", () => {
  it("enabled: true で、本文の最後に区切り線と 1 行が付く。リンク先はストアの URL", () => {
    const out = appendCredit("## 見出し\n\n本文です。\n", true);
    assert.ok(out.startsWith("## 見出し\n\n本文です。\n\n---\n\n"), out);
    assert.ok(out.endsWith(`この記事は、[Last One Click](${CREDIT_URL}) で下書きしました。\n`), out);
    assert.equal(CREDIT_URL, "https://chromewebstore.google.com/detail/last-one-click/jomapffkhcdpnodaffobmpfofnnaihnd");
  });

  it("enabled: false で、本文がまったく変わらない", () => {
    for (const src of ["", "本文", "## 見出し\n\n本文です。\n\n\n"]) assert.equal(appendCredit(src, false), src);
  });

  it("front matter のある md に付けても、front matter の読み取り結果が変わらない", async () => {
    const src = "---\ntitle: タイトル\nhashtags: [a, b]\nmagazine: マガジン\nthumbnail: ./thumbnail.png\n---\n\n## 見出し\n\n本文です。\n";
    const before = await render(src);
    const after = await render(appendCredit(src, true));
    assert.equal(after.title, before.title);
    assert.deepEqual(after.hashtags, before.hashtags);
    assert.equal(after.magazine, before.magazine);
    assert.equal(after.thumbnail, before.thumbnail);
  });

  it("本文の最後に改行が無い md でも、区切り線が直前の段落とつながらない(見出しにならない)", async () => {
    const a = await render(appendCredit("---\ntitle: t\n---\n\n最後の段落", true));
    assert.ok(a.html.includes("<p>最後の段落</p>"), a.html);
    assert.ok(!a.html.includes("<h2>最後の段落</h2>"), a.html);
    assert.ok(a.html.includes("<hr>"), a.html);
  });

  it("変換後の HTML に <hr> と、ストアの URL の <a> が含まれる(SAFE_RENDERER を通しても落ちない)", async () => {
    const a = await render(appendCredit("---\ntitle: t\n---\n\n本文です。\n", true));
    assert.ok(a.html.includes("<hr>"), a.html);
    assert.ok(a.html.includes(`<a href="${CREDIT_URL}">Last One Click</a>`), a.html);
    assert.ok(a.html.includes("この記事は、"), a.html);
  });
});
