// templates/note-paid/article.md(有料記事の見本)が、そのまま読み込んで有料の下書きになるかを確かめる。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Marked } from "marked";
import { parse as parseYaml } from "yaml";
import { renderArticle } from "./article.js";
import { SAFE_RENDERER } from "./markdown-safe.js";

const md = new Marked({ gfm: true, breaks: true, renderer: SAFE_RENDERER as never });
const convert = { markdown: (s: string) => md.parse(s) as string, yaml: parseYaml };
const src = readFileSync(new URL("../templates/note-paid/article.md", import.meta.url), "utf8");

describe("templates/note-paid/article.md(有料記事の見本)", () => {
  it("価格と有料の境目が読め、印は本文に残らない", async () => {
    const a = await renderArticle(src, convert);
    assert.equal(a.title, "有料記事のタイトル");
    assert.equal(a.price, 300);
    assert.equal(a.paywallAnchor, "無料で読めるのはここまでです。");
    assert.equal(a.magazine, undefined);
    // 本文の説明の中の `<!-- ここから有料 -->`(インラインコード)は文字で残り、印の行そのものは残らない
    assert.equal(a.html.match(/&lt;!-- ここから有料 --&gt;/g)?.length, 1);
    assert.match(a.html, /<code>&lt;!-- ここから有料 --&gt;<\/code>/);
  });

  it("印の直前の段落と同じ文字の段落は、ほかに無い(ラインを引く場所が 1 つに決まる)", async () => {
    const a = await renderArticle(src, convert);
    const paragraphs = [...a.html.matchAll(/<p>([^<]*)<\/p>/g)].map((m) => m[1]);
    assert.equal(paragraphs.filter((p) => p === a.paywallAnchor).length, 1);
  });
});
