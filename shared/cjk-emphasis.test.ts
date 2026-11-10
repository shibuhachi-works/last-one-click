import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Marked } from "marked";
import { CJK_EMPHASIS_EXTENSIONS, touchesCjkPunct } from "./cjk-emphasis.js";
import { SAFE_RENDERER } from "./markdown-safe.js";

// 拡張と同じ設定(gfm・breaks・SAFE_RENDERER)。with は日本語の強調の拡張あり、without は無し
const withExt = new Marked({ gfm: true, breaks: true, renderer: SAFE_RENDERER as never, extensions: CJK_EMPHASIS_EXTENSIONS as never });
const without = new Marked({ gfm: true, breaks: true, renderer: SAFE_RENDERER as never });
const html = (m: Marked, s: string) => (m.parse(s) as string).trim();

describe("日本語のかぎかっこ・句読点に接した強調", () => {
  it("**「…」** の形が太字になり、** が残らない", () => {
    for (const [src, strong] of [
      ["説明はたいてい、**「マグネシウムが肌から入って効く」**というものです。", "「マグネシウムが肌から入って効く」"],
      ["効能は**「お湯で温まる・汚れが落ちる」効果を高めた結果**です。", "「お湯で温まる・汚れが落ちる」効果を高めた結果"],
      ["結論は、**「主張は科学的に支持されない」**でした。", "「主張は科学的に支持されない」"],
    ]) {
      const out = html(withExt, src);
      assert.ok(out.includes(`<strong>${strong}</strong>`), out);
      assert.ok(!out.includes("**"), out);
      // 拡張が無いと太字にならない(この拡張が要る理由)
      assert.ok(!html(without, src).includes("<strong>"), src);
    }
  });

  it("「**…**」 の形(今も太字になる形)は、これまでどおり太字", () => {
    const src = "説明はたいてい、「**マグネシウムが肌から入って効く**」というものです。";
    assert.equal(html(withExt, src), html(without, src));
    assert.ok(html(withExt, src).includes("<strong>マグネシウムが肌から入って効く</strong>"));
  });

  it("太字の中のリンクも、そのまま変換される", () => {
    const out = html(withExt, "これは**「[リンク](https://example.com)を見る」**です。");
    assert.ok(out.includes('<strong>「<a href="https://example.com">リンク</a>を見る」</strong>'), out);
  });

  it("リンク先の URL に ** があっても、リンクの途中で太字を閉じない", () => {
    const out = html(withExt, "これは**「[リンク](https://example.com/a**b)」**です。");
    assert.ok(out.includes('<strong>「<a href="https://example.com/a**b">リンク</a>」</strong>'), out);
    // 句読点に接していない形は、これまでどおり marked に任せる
    const plain = "これは**[リンク](https://example.com/a**b)**です。";
    assert.equal(html(withExt, plain), html(without, plain));
  });

  it("エスケープされた \\* は閉じる印にしない", () => {
    const em = html(withExt, "これは*「a\\*b」*です。");
    assert.ok(em.includes("<em>「a*b」</em>"), em);
    const strong = html(withExt, "これは**「a\\**b」**です。");
    assert.ok(strong.includes("<strong>「a**b」</strong>"), strong);
  });

  it("本文の比較記号 < > やかっこで、別々の太字をつなげない", () => {
    for (const src of ["**「x < 0」** と **「x > 0」**", "**「a (b」** と **「c」**", "**「[注」** と **「d」**"]) {
      const out = html(withExt, src);
      assert.equal((out.match(/<strong>/g) ?? []).length, 2, out);
      assert.ok(out.includes("</strong> と <strong>"), out);
      assert.ok(!out.includes("**"), out);
    }
  });

  it("自動リンクの中の ** でも太字を閉じない", () => {
    const out = html(withExt, "**「<https://example.com/a**b>」**です。");
    assert.ok(out.includes('<strong>「<a href="https://example.com/a**b">https://example.com/a**b</a>」</strong>'), out);
  });

  it("太字の中にインラインコードがあるときは受け持たず、これまでどおり(コードの中の ** と取り違えないため)", () => {
    const src = "これは**「`code`を使う」**です。";
    assert.equal(html(withExt, src), html(without, src));
  });

  it("斜体(* 1 つ)も同じ条件で強調になる", () => {
    const out = html(withExt, "これは*「斜体」*です。");
    assert.ok(out.includes("<em>「斜体」</em>"), out);
  });

  it("英語や、句読点に接していない強調の結果は変わらない", () => {
    for (const src of [
      "**bold**",
      "a**b**c",
      "**not closed",
      "x ** y ** z",
      "***both***",
      "*em* and **strong**",
      '**"quoted"**word',
      "日本語の**太字**です。",
      "- **項目**: 説明",
    ]) {
      assert.equal(html(withExt, src), html(without, src), src);
    }
  });

  it("コードの中の ** は変換しない", () => {
    for (const src of ["`**「a」**`", "```\n**「a」**\n```", "前 `**「a」**` 後"]) {
      const out = html(withExt, src);
      assert.ok(!out.includes("<strong>"), out);
      assert.equal(out, html(without, src), src);
    }
  });

  it("閉じていない **「 は、強調にしない", () => {
    const src = "これは**「閉じていない";
    assert.equal(html(withExt, src), html(without, src));
  });

  it("touchesCjkPunct: 中身の最初か最後が全角の句読点のときだけ true", () => {
    assert.equal(touchesCjkPunct("「a」"), true);
    assert.equal(touchesCjkPunct("a、"), true);
    assert.equal(touchesCjkPunct("（注）"), true);
    assert.equal(touchesCjkPunct("太字"), false);
    assert.equal(touchesCjkPunct('"quoted"'), false);
  });
});
