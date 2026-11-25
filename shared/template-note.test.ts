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
  ["本文の画像(ファイル名で書いた画像)", /!\[[^\]]*\]\((?!https?:)[^)\s]+(?:\s+"[^"]*")?\)/, /<img src="(?!https?:)[^"]+"/],
  ["本文の動く画像(gif)", /!\[[^\]]*\]\([^)\s]+\.gif(?:\s+"[^"]*")?\)/, /<img src="[^"]+\.gif"/],
  ["本文の画像のキャプション(\"…\" で書いた title)", /!\[[^\]]*\]\([^)\s]+\s+"[^"]+"\)/, /<img [^>]*title="[^"]+"/],
  ["目次の説明", /目次/, /目次/],
  ["最後の 1 行(下書きしました)の説明", /下書きしました/, /下書きしました/],
  ["チェックで入るハッシュタグ #LastOneClick の説明", /ハッシュタグ #LastOneClick/, /ハッシュタグ #LastOneClick/],
  ["自分用のメモ(<!-- … -->)の説明", /`<!-- … -->` で囲んだ所は/, /<code>&lt;!-- … --&gt;<\/code> で囲んだ所は/],
];

/** 見本の front matter にコメントで入れておく書き方(先頭の「# 」を消すと使える)。[名前, md に含まれること] */
const FRONT_MATTER_FEATURES: [string, RegExp][] = [
  ["マガジン(magazine)", /^# magazine: /m],
  ["記事を作るアカウント(note_account)", /^# note_account: /m],
  ["有料記事の価格(price)", /^# price: 300\b/m],
  ["有料の境目の印(<!-- ここから有料 -->)の説明", /^# .*「<!-- ここから有料 -->」だけの行/m],
  ["入れる先(target)", /^# target: note\b/m],
  ["要約(summary。追加の対応先だけ)", /^# summary: /m],
  ["カテゴリ(category。追加の対応先だけ)", /^# category: /m],
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

  it("自分用のメモ(<!-- … -->)の行は、見本の md にあり、変換後の本文には入らない", async () => {
    assert.match(src, /^<!-- この行は自分用のメモです。/m, "見本の md に自分用のメモの行が無い");
    const { html } = await renderArticle(src, convert);
    assert.doesNotMatch(html, /この行は自分用のメモです/);
  });

  it("front matter の省略できる項目を、コメントで見せている。先頭の「# 」を消すと、その値が入る", async () => {
    for (const [name, inMd] of FRONT_MATTER_FEATURES) assert.match(src, inMd, `見本の front matter に「${name}」が無い`);
    // そのまま読み込んでも有料にならないよう、price はコメントにしてある
    assert.equal((await renderArticle(src, convert)).price, undefined);
    assert.equal((await renderArticle(src.replace(/^# price: /m, "price: "), convert)).price, 300);
    // そのまま読み込んでもアカウントを比べないよう、note_account はコメントにしてある
    assert.equal((await renderArticle(src, convert)).noteAccount, undefined);
    assert.equal((await renderArticle(src.replace(/^# note_account: /m, "note_account: "), convert)).noteAccount, "example");
    // summary・category はコメントにしてある(note には入れない)。先頭の「# 」を消すと読める
    const plain = await renderArticle(src, convert);
    assert.equal(plain.summary, undefined);
    assert.equal(plain.category, undefined);
    const extra = await renderArticle(src.replace(/^# summary: /m, "summary: ").replace(/^# category: /m, "category: "), convert);
    assert.equal(extra.summary, "記事の要約");
    assert.equal(extra.category, "カテゴリの名前");
    // 見本の本文には印を入れていない(入れると見本が有料になる)。price と一緒に本文に印を足すと、その位置が読める
    assert.equal((await renderArticle(src, convert)).paywallAnchor, undefined);
    const paid = src.replace(/^# price: /m, "price: ").replace(/^(本文はここから書きます。.*)$/m, "$1\n\n<!-- ここから有料 -->");
    const a = await renderArticle(paid, convert);
    assert.match(a.paywallAnchor ?? "", /^本文はここから書きます。/);
    assert.doesNotMatch(a.html, /ここから有料/);
  });

    it("ファイル名で書いた本文の画像は、見本と同じフォルダに置いてある(GitHub から読み込んで試せるように)", () => {
    const names = [...src.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
    assert.ok(names.length > 0);
    for (const n of names) assert.ok(existsSync(new URL(`../templates/note/${n}`, import.meta.url)), `${n} がありません`);
  });

  it("note に入らない表は使っていない", () => {
    assert.doesNotMatch(src, /^\|.*\|$/m);
  });
});
