import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Marked } from "marked";
import { SAFE_RENDERER, htmlToText, isSafeUrl, sanitizeUrl } from "./markdown-safe.js";

const md = new Marked({ gfm: true, breaks: true, renderer: SAFE_RENDERER as never });
const render = (s: string) => md.parse(s) as string;

describe("SAFE_RENDERER", () => {
  it("コードブロックの最後に改行を足さない(note で空の行になるため #59)。途中の空行・エスケープ・言語は今までどおり", () => {
    const url = "https://github.com/shibuhachi-works/last-one-click/tree/main/templates/note";
    assert.equal(render("```\n" + url + "\n```\n"), `<pre><code>${url}</code></pre>\n`);
    assert.equal(render("```\n1 行目\n\n3 行目\n```\n"), "<pre><code>1 行目\n\n3 行目</code></pre>\n");
    assert.equal(render("```js\nconst a = 1 < 2 && b > 0;\n```\n"), '<pre><code class="language-js">const a = 1 &lt; 2 &amp;&amp; b &gt; 0;</code></pre>\n');
    assert.equal(render("前の段落\n\n    indented\n    x\n"), "<p>前の段落</p>\n<pre><code>indented\nx</code></pre>\n");
    assert.ok(!/\n<\/code><\/pre>/.test(render("```\na\nb\n```\n\n    c\n")));
  });

  it("インラインコードは変えない", () => {
    assert.equal(render("文の中の `a < b` です"), "<p>文の中の <code>a &lt; b</code> です</p>\n");
  });

  it("onerror 付きの img(生の HTML)は文字として出て、属性としては残らない", () => {
    const out = render('前\n\n<img src=x onerror="alert(1)">\n\n後');
    assert.ok(!/<img/i.test(out), out); // タグとしては存在しない
    assert.ok(!/<[^>]*onerror/i.test(out), out); // 属性としても存在しない(文字として見えるのは可)
    assert.ok(out.includes("&lt;img"), out);
  });
  it("インラインの生 HTML も同じ", () => {
    const out = render('a <script>alert(1)</script> b');
    assert.ok(!/<script/i.test(out), out);
  });
  it("javascript: のリンクは文字だけになる", () => {
    const out = render("[押す](javascript:alert(1))");
    assert.ok(!/javascript:/i.test(out), out);
    assert.ok(out.includes("押す"), out);
  });
  it("https のリンク・画像はそのまま", () => {
    const out = render("[note](https://note.com/) ![t](https://example.com/a.png)");
    assert.ok(out.includes('<a href="https://note.com/">note</a>'), out);
    assert.ok(out.includes('<img src="https://example.com/a.png" alt="t">'), out);
  });
  it("data: の画像は落とす", () => {
    const out = render("![x](data:image/svg+xml;base64,AAAA)");
    assert.ok(!/<img/i.test(out), out);
  });
  it("URL の途中にタブ・改行があっても javascript: として扱って落とす(ブラウザと同じ正規化)", () => {
    for (const src of ["[x](<java\tscript:alert(1)>)", "[x](<java\nscript:alert(1)>)", "[x](<\tjavascript:alert(1)>)"]) {
      const out = render(src);
      // リンクにならない(文字として残るのは可。改行入りは marked がリンクと見なさない)
      assert.ok(!/<a\b/i.test(out), `${JSON.stringify(src)} → ${out}`);
      assert.ok(out.includes("x"), out);
    }
  });
  it("marked がエスケープ済みの alt / title は二重エスケープしない。href は一度だけエスケープする", () => {
    const out = render('![A & B](https://example.com/a.png?x=1&y=2 "T \\"q\\" & x")');
    assert.ok(out.includes('alt="A &amp; B"'), out);
    assert.ok(out.includes('title="T &quot;q&quot; &amp; x"'), out);
    assert.ok(out.includes('src="https://example.com/a.png?x=1&amp;y=2"'), out);
    assert.ok(!out.includes("&amp;amp;"), out);
    const link = render('[A & B](https://example.com/?a=1&b=2 "T & x")');
    assert.ok(link.includes('<a href="https://example.com/?a=1&amp;b=2" title="T &amp; x">A &amp; B</a>'), link);
  });
  it("URL に書かれた文字参照(&amp;)は二重にエスケープしない。戻せない名前や javascript への化けは起きない(Codex の指摘)", () => {
    const out = render("[x](https://example.com/?a=1&amp;b=2) ![y](https://example.com/i.png?a=1&amp;b=2)");
    assert.ok(out.includes('<a href="https://example.com/?a=1&amp;b=2">x</a>'), out);
    assert.ok(out.includes('<img src="https://example.com/i.png?a=1&amp;b=2" alt="y">'), out);
    assert.ok(!out.includes("&amp;amp;"), out);
    // 数値参照で隠した javascript: は戻してから検査するので落ちる
    assert.ok(!/<a\b/i.test(render("[x](java&#115;cript:alert(1))")), "numeric");
    assert.ok(!/<a\b/i.test(render("[x](&#x6A;avascript:alert(1))")), "hex");
    // 戻せない名前(&colon; は HTML5 のみ)は & が &amp; になるので、ブラウザでも "javascript&colon;..." という文字のまま
    const colon = render("[x](javascript&colon;alert(1))");
    assert.ok(!/href="[^"]*javascript:/i.test(colon), colon);
    assert.ok(!/javascript&colon;/.test(colon), colon); // 生の &colon; は出ない
  });
  it("見出し・箇条書き・太字・引用・コードは普通に出る", () => {
    const out = render("## 見出し\n\n- a\n- **b**\n\n> 引用\n\n```\ncode\n```");
    for (const s of ["<h2>", "<ul>", "<strong>b</strong>", "<blockquote>", "<pre><code>"]) assert.ok(out.includes(s), s);
  });
});

describe("SAFE_RENDERER(marked の版によらない)", () => {
  // marked 14 は alt / title をエスケープ済みで、marked 18 は生の文字で渡す。どちらでも一度だけエスケープした形になる
  const image = SAFE_RENDERER.image.bind(SAFE_RENDERER);
  it("生の文字の alt / title の \" や & は、エスケープしてから属性に出す(属性を壊さない)", () => {
    const out = image({ href: "https://example.com/a.png", text: 'A & B "x"', title: 'T "q" & x' });
    assert.equal(out, '<img src="https://example.com/a.png" alt="A &amp; B &quot;x&quot;" title="T &quot;q&quot; &amp; x">');
  });
  it("エスケープ済みの alt / title は、二重にエスケープしない", () => {
    const out = image({ href: "https://example.com/a.png", text: "A &amp; B &quot;x&quot;", title: "T &quot;q&quot; &amp; x" });
    assert.equal(out, '<img src="https://example.com/a.png" alt="A &amp; B &quot;x&quot;" title="T &quot;q&quot; &amp; x">');
  });
  it("URL が通らない画像は、alt を文字として出す(タグにしない)", () => {
    assert.equal(image({ href: "javascript:alert(1)", text: '<img src=x onerror="alert(1)">' }), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("isSafeUrl", () => {
  it("相対パスは許可、// 始まりは不許可", () => {
    assert.equal(isSafeUrl("./a.png", ["http:", "https:"]), true);
    assert.equal(isSafeUrl("//evil.example/x", ["http:", "https:"]), false);
    assert.equal(isSafeUrl("JAVASCRIPT:alert(1)", ["http:", "https:"]), false);
    assert.equal(isSafeUrl("mailto:a@example.com", ["mailto:"]), true);
  });
  it("タブ・改行・前後の制御文字はブラウザと同じく取り除いてから scheme を見る", () => {
    assert.equal(sanitizeUrl("java\tscript:alert(1)", ["http:", "https:"]), null);
    assert.equal(sanitizeUrl("java\nscript:alert(1)", ["http:", "https:"]), null);
    assert.equal(sanitizeUrl("\u0001javascript:alert(1)", ["http:", "https:"]), null);
    assert.equal(sanitizeUrl(" \thttps://e.com/a\tb\n", ["http:", "https:"]), "https://e.com/ab");
    assert.equal(sanitizeUrl("https://e.com/a\u0001b", ["http:", "https:"]), null); // 残った制御文字は拒否
    assert.equal(sanitizeUrl("./a b.png", ["http:", "https:"]), "./a b.png");
  });
});

describe("htmlToText", () => {
  it("タグを除き、ブロックの切れ目を改行にし、実体参照を戻す", () => {
    const t = htmlToText("<h2>見出し</h2><p>a &amp; b<br>c &#x4e00; &#19968;</p><script>x</script>");
    assert.equal(t, "見出し\na & b\nc 一 一");
  });
  it("Playwright 版の text/plain が空にならない", () => {
    assert.notEqual(htmlToText("<p>本文</p>"), "");
  });
  it("名前付き文字参照(&copy; &mdash; など)も戻す。text/html と text/plain の内容が食い違わない(Codex の指摘)", () => {
    assert.equal(htmlToText("<p>&copy; 2026 &mdash; a &rarr; b&hellip; &Agrave;&agrave; &nbsp;x</p>"), "© 2026 — a → b… Àà \u00a0x"); // &nbsp; は DOM と同じ U+00A0
    assert.equal(htmlToText(render("&copy; 2026 &mdash; &rarr;")), "© 2026 — →"); // marked は文字参照をそのまま通す
  });
  it("コードブロックの中は空白・改行をそのまま残す。先頭の字下げも消えない(Codex の指摘)", () => {
    const code = 'def f():\n    x = """a\n\n\n b"""\n';
    const t = htmlToText(`<pre><code class="language-python">${code.replace(/"/g, "&quot;")}</code></pre>\n<p>t</p>\n`);
    assert.equal(t, `${code}\nt`);
    assert.equal(htmlToText("<pre><code>    indented\n\n\n    x\n</code></pre>"), "    indented\n\n\n    x");
    assert.equal(htmlToText(render("```\nfirst\n\n\nlast\n```\n\n本文")), "first\n\n\nlast\n\n本文");
  });
  it("壊れた実体参照はそのまま", () => {
    assert.equal(htmlToText("a &unknown; b &#; c"), "a &unknown; b &#; c");
  });
});
