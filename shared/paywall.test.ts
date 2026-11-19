// 本文の「ここから有料」の印(<!-- ここから有料 -->)の読み取り。renderArticle を通して確かめる
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Marked } from "marked";
import { parse as parseYaml } from "yaml";
import { renderArticle } from "./article.js";
import { SAFE_RENDERER } from "./markdown-safe.js";
import { PAYWALL_MARKER, lastTopLevelBlock, makePaywallToken, paywallFailureMessage } from "./paywall.js";

const md = new Marked({ gfm: true, breaks: true, renderer: SAFE_RENDERER as never });
const convert = { markdown: (s: string) => md.parse(s) as string, yaml: parseYaml };
const PRICE = "---\ntitle: T\nprice: 300\n---\n";
const render = (body: string, head = PRICE) => renderArticle(head + body, convert);

describe("本文の「ここから有料」の印", () => {
  it("印あり: 印の直前のブロックの文字を paywallAnchor に入れ、印の行は HTML に残さない", async () => {
    const a = await render(`無料の段落です。\n\n${PAYWALL_MARKER}\n\n有料の段落です。\n`);
    assert.equal(a.paywallAnchor, "無料の段落です。");
    assert.equal(a.html, "<p>無料の段落です。</p>\n<p>有料の段落です。</p>\n");
    assert.doesNotMatch(a.html, /ここから有料|&lt;!--|LASTONECLICK/);
    assert.equal(a.price, 300);
  });

  it("印なし: paywallAnchor は無く、HTML も変わらない", async () => {
    const a = await render("無料の段落です。\n\n有料かもしれない段落。\n");
    assert.equal(a.paywallAnchor, undefined);
    assert.equal("paywallAnchor" in a, false);
    assert.equal(a.html, "<p>無料の段落です。</p>\n<p>有料かもしれない段落。</p>\n");
  });

  it("印が 2 つ: 何行目かを添えてエラー", async () => {
    await assert.rejects(render(`a\n\n${PAYWALL_MARKER}\n\nb\n\n${PAYWALL_MARKER}\n\nc\n`), /2 つあります.*3・7 行目.*1 か所だけ/);
  });

  it("印が本文の最初(前に無料の部分が無い): エラー。タイトルに使った # 見出しだけが前にあるときも同じ", async () => {
    await assert.rejects(render(`${PAYWALL_MARKER}\n\n有料\n`), /前に本文がありません/);
    await assert.rejects(render(`\n\n  ${PAYWALL_MARKER}\n有料\n`), /前に本文がありません/);
    await assert.rejects(renderArticle(`---\nprice: 300\n---\n# タイトル\n\n${PAYWALL_MARKER}\n\n有料\n`, convert), /前に本文がありません/);
  });

  it("コードブロックの中の印は印として扱わず、文字のまま残す(``` と ~~~)", async () => {
    const a = await render("```md\n" + PAYWALL_MARKER + "\n```\n\n~~~~\n" + PAYWALL_MARKER + "\n```\n~~~~\n", "---\ntitle: T\n---\n");
    assert.equal(a.paywallAnchor, undefined);
    assert.equal((a.html.match(/&lt;!-- ここから有料 --&gt;/g) ?? []).length, 2);
    // コードブロックの後ろの印は印として読む
    const b = await render("```\nx\n```\n\nあと\n\n" + PAYWALL_MARKER + "\n\n有料\n");
    assert.equal(b.paywallAnchor, "あと");
  });

  it("前後に空白があっても印として読む。段落のすぐ下(空行なし)に書いても、段落は分かれない", async () => {
    const a = await render(`無料の 1 行目\n無料の 2 行目\n \t${PAYWALL_MARKER}　 \n有料\n`);
    assert.equal(a.paywallAnchor, "無料の 1 行目無料の 2 行目");
    assert.equal(a.html, "<p>無料の 1 行目<br>無料の 2 行目</p>\n<p>有料</p>\n");
  });

  it("印の前後のほかの文字が付いた行や、ほかの HTML コメントは、これまでどおり文字として出す", async () => {
    const a = await render(`<!-- メモ -->\n\n無料 ${PAYWALL_MARKER}\n`, "---\ntitle: T\n---\n");
    assert.equal(a.paywallAnchor, undefined);
    assert.match(a.html, /&lt;!-- メモ --&gt;/);
    assert.match(a.html, /無料 &lt;!-- ここから有料 --&gt;/);
  });

  it("字下げのコード(空行のあとの 4 字以上の字下げ・タブ)の中の印は印として扱わない。無料の記事もエラーにならない", async () => {
    const free = "---\ntitle: T\n---\n";
    for (const indent of ["    ", "\t", "  \t", "        "]) {
      const a = await render(`例:\n\n${indent}${PAYWALL_MARKER}\n\n続き\n`, free);
      assert.equal(a.paywallAnchor, undefined, JSON.stringify(indent));
      assert.match(a.html, /<pre><code>\s*&lt;!-- ここから有料 --&gt;/, JSON.stringify(indent));
    }
    // 字下げのコードが空行をはさんで続くときも、コードの中
    const b = await render(`例:\n\n    a\n\n    ${PAYWALL_MARKER}\n\n続き\n`, free);
    assert.equal(b.paywallAnchor, undefined);
    // コードのあとの、字下げの無い印は読む
    const c = await render(`例:\n\n    code\n\n${PAYWALL_MARKER}\n\n有料\n`);
    assert.equal(c.paywallAnchor, "code");
  });

  it("箇条書き・引用の中のコード(フェンス)の中の印は印として扱わず、コードの形も崩さない", async () => {
    const free = "---\ntitle: T\n---\n";
    const a = await render(`- 例:\n\n  \`\`\`md\n  ${PAYWALL_MARKER}\n  \`\`\`\n\n続き\n`, free);
    assert.equal(a.paywallAnchor, undefined);
    assert.match(a.html, /<code[^>]*>&lt;!-- ここから有料 --&gt;/);
    const b = await render(`- \`\`\`md\n  ${PAYWALL_MARKER}\n  \`\`\`\n\n続き\n`, free);
    assert.equal(b.paywallAnchor, undefined);
    assert.match(b.html, /<code[^>]*>&lt;!-- ここから有料 --&gt;/);
    const c = await render(`> \`\`\`\n> ${PAYWALL_MARKER}\n> \`\`\`\n\n続き\n`, free);
    assert.equal(c.paywallAnchor, undefined);
    // コードの中の印と、本当の印が 1 つずつ: 本当の印だけを読む(2 つあるエラーにしない)
    const d = await render(`例:\n\n\`\`\`\n${PAYWALL_MARKER}\n\`\`\`\n\n無料の最後\n\n${PAYWALL_MARKER}\n\n有料\n`);
    assert.equal(d.paywallAnchor, "無料の最後");
  });

  it("目印の段落の名前付き文字参照(&copy; &mdash; など)は表示の文字に戻す", async () => {
    const a = await render(`&copy; 2026 &mdash; 無料はここまで&hellip;\n\n${PAYWALL_MARKER}\n\n有料\n`);
    assert.equal(a.paywallAnchor, "© 2026 — 無料はここまで…");
    assert.equal(lastTopLevelBlock("<p>A&nbsp;&amp;&nbsp;B &lt;tag&gt; &#x41;&#66;</p>"), "A\u00a0&\u00a0B <tag> AB");
  });

  it("price なし: 直し方を添えてエラー。ポップアップの欄(final)で価格を入れれば通る", async () => {
    await assert.rejects(render(`無料\n\n${PAYWALL_MARKER}\n\n有料\n`, "---\ntitle: T\n---\n"), /price がありません.*price: 300/);
    const src = `---\ntitle: T\n---\n無料\n\n${PAYWALL_MARKER}\n\n有料\n`;
    await assert.rejects(renderArticle(src, convert, { title: "T", final: true }), /price がありません/);
    const a = await renderArticle(src, convert, { title: "T", price: "500", final: true });
    assert.equal(a.price, 500);
    assert.equal(a.paywallAnchor, "無料");
  });

  it("直前のブロックが見出し・箇条書き・引用なら、その文字(タグと文字参照を除いたもの)を目印にする", async () => {
    assert.equal((await render(`## 見出し &amp; **太字**\n\n${PAYWALL_MARKER}\n\nx\n`)).paywallAnchor, "見出し & 太字");
    assert.equal((await render(`- いち\n- に\n${PAYWALL_MARKER}\n\nx\n`)).paywallAnchor, "いち\nに");
    assert.equal((await render(`> 引用 <b>\n\n${PAYWALL_MARKER}\n\nx\n`)).paywallAnchor, "引用 <b>");
    // 区切り線のすぐ後ろは文字が無い(拡張は押さずに「手で」と出す)
    assert.equal((await render(`a\n\n***\n\n${PAYWALL_MARKER}\n\nx\n`)).paywallAnchor, "");
  });

  it("本文の md に目印と同じ文字があっても取り違えない", async () => {
    const t = makePaywallToken("");
    assert.notEqual(makePaywallToken(t), t);
    const a = await render(`${t}\n\n${PAYWALL_MARKER}\n\n有料\n`);
    assert.equal(a.paywallAnchor, t);
    assert.equal(a.html, `<p>${t}</p>\n<p>有料</p>\n`);
  });
});

describe("lastTopLevelBlock", () => {
  it("いちばん外側の最後の要素の文字を返す。入れ子・空要素も数える", () => {
    assert.equal(lastTopLevelBlock("<p>a</p>\n<ul>\n<li><p>b</p><ul><li>c</li></ul></li>\n</ul>\n"), "bc");
    assert.equal(lastTopLevelBlock("<p>a</p>\n<hr>\n"), "");
    assert.equal(lastTopLevelBlock(""), undefined);
  });
});

describe("paywallFailureMessage", () => {
  it("どの失敗でも、手でラインを引くよう案内する", () => {
    for (const status of ["no-screen", "no-anchor", "not-found", "many", "no-button"] as const) {
      assert.match(paywallFailureMessage({ status, count: 2 }), /手でラインを引いてください/);
    }
    assert.match(paywallFailureMessage({ status: "many", count: 3 }), /3 つ/);
  });
});
