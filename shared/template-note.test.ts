// templates/note/article.md(見本)が、拡張でできることを全部見せているかを確かめる。
// 機能を足したら、見本の md とこのテストの FEATURES の両方に足す(AGENTS.md の決まり)。
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Marked } from "marked";
import { parse as parseYaml } from "yaml";
import { renderArticle } from "./article.js";
import { SAFE_RENDERER } from "./markdown-safe.js";

const md = new Marked({ gfm: true, breaks: true, renderer: SAFE_RENDERER as never });
const convert = { markdown: (s: string) => md.parse(s) as string, yaml: parseYaml };
const src = readFileSync(new URL("../templates/note/article.md", import.meta.url), "utf8");

/** 見本に入れておく書き方。[名前, md に含まれること, 変換後の HTML に含まれること] */
const FEATURES: [string, RegExp, RegExp][] = [
  ["大見出し", /^## /m, /<h2>/],
  ["小見出し", /^### /m, /<h3>/],
  ["太字", /\*\*[^*「]+\*\*/, /<strong>/],
  ["かぎかっこごとの太字", /\*\*「[^」]+」\*\*/, /<strong>/],
  ["箇条書き", /^- /m, /<ul>/],
  ["番号付きの箇条書き", /^1\. /m, /<ol>/],
  ["引用", /^> /m, /<blockquote>/],
  ["リンク", /\[[^\]]+\]\(https:\/\/[^)]+\)/, /<a href="https:/],
  ["インラインコード", /`[^`\n]+`/, /<code>/],
  ["コードのかたまり", /^```/m, /<pre>/],
  ["区切り線", /^---$/m, /<hr>/],
  ["埋め込みにする URL だけの行", /^https?:\/\/\S+$/m, /<p><a href="https:[^"]+">https:[^<]+<\/a><\/p>/],
  ["本文の画像(ファイル名で書いた画像)", /!\[[^\]]*\]\((?!https?:)[^)\s]+\)/, /<img src="(?!https?:)[^"]+"/],
  ["目次の説明", /目次/, /目次/],
  ["最後の 1 行(下書きしました)の説明", /下書きしました/, /下書きしました/],
  ["チェックで入るハッシュタグ #LastOneClick の説明", /ハッシュタグ #LastOneClick/, /ハッシュタグ #LastOneClick/],
];

describe("templates/note/article.md(見本)", () => {
  it("front matter が読め、タイトル・ハッシュタグ・見出し画像が入る", async () => {
    const a = await renderArticle(src, convert);
    assert.equal(a.title, "記事のタイトル");
    assert.deepEqual(a.hashtags, ["LastOneClick", "最後のワンクリックは自分で", "コピペ卒業", "公開ボタンは押さない派", "貼り直しはもう嫌だ", "下書きは拡張に任せた", "投稿ボタンは自分で押す", "AIと一緒に書いて下書きは自動化"]);
    assert.equal(a.thumbnail, "./thumbnail.png");
    // そのまま読み込んでもマガジンで止まらないよう、magazine はコメントにしてある
    assert.equal(a.magazine, undefined);
  });

  it("拡張でできることを全部見せている", async () => {
    const { html } = await renderArticle(src, convert);
    for (const [name, inMd, inHtml] of FEATURES) {
      assert.match(src, inMd, `見本の md に「${name}」が無い`);
      assert.match(html, inHtml, `見本の HTML に「${name}」が無い`);
    }
  });

  it("ファイル名で書いた本文の画像は、見本と同じフォルダに置いてある(GitHub から読み込んで試せるように)", () => {
    const names = [...src.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
    assert.ok(names.length > 0);
    for (const n of names) assert.ok(existsSync(new URL(`../templates/note/${n}`, import.meta.url)), `${n} がありません`);
  });

  it("note に入らない表は使っていない", () => {
    assert.doesNotMatch(src, /^\|.*\|$/m);
  });
});
