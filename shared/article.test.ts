import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Marked } from "marked";
import { parse as parseYaml } from "yaml";
import { checkTarget, parseFrontMatter, parsePrice, renderArticle, resolveArticleUrl, splitList } from "./article.js";
import { SAFE_RENDERER } from "./markdown-safe.js";

const md = new Marked({ gfm: true, breaks: true, renderer: SAFE_RENDERER as never });
const convert = { markdown: (s: string) => md.parse(s) as string, yaml: parseYaml };
const fm = (s: string) => parseFrontMatter(s, parseYaml);

describe("resolveArticleUrl", () => {
  it("tree(ディレクトリ)→ article.md と同ディレクトリ", () => {
    assert.deepEqual(resolveArticleUrl("https://github.com/o/r/tree/main/posts/2026-10-28-x/"), {
      mdUrl: "https://raw.githubusercontent.com/o/r/main/posts/2026-10-28-x/article.md",
      baseUrl: "https://raw.githubusercontent.com/o/r/main/posts/2026-10-28-x",
    });
  });
  it("blob(ファイル)と raw はそのファイル", () => {
    const want = {
      mdUrl: "https://raw.githubusercontent.com/o/r/main/posts/x/note.md",
      baseUrl: "https://raw.githubusercontent.com/o/r/main/posts/x",
    };
    assert.deepEqual(resolveArticleUrl("https://github.com/o/r/blob/main/posts/x/note.md"), want);
    assert.deepEqual(resolveArticleUrl("https://raw.githubusercontent.com/o/r/main/posts/x/note.md"), want);
  });
  it("対応しない URL はエラー", () => {
    assert.throws(() => resolveArticleUrl("https://example.com/o/r/tree/main/x"), /対応していない/);
    assert.throws(() => resolveArticleUrl("https://github.com/o/r"), /tree\/blob/);
  });
});

describe("parseFrontMatter(YAML は yaml パッケージ。gray-matter で読めていた形がそのまま読める)", () => {
  it("README の例: key: value / [a, b] / 行末コメント / 引用符", () => {
    const { data, content } = fm(
      ['---', 'title: "見出し: 副題"', "hashtags: [AI, 個人開発]   # 省略可", "magazine: マガジン名       # 省略可", "thumbnail: ./thumbnail.png", "unknown: x", "---", "", "本文"].join("\n"),
    );
    assert.deepEqual(data, { title: "見出し: 副題", hashtags: ["AI", "個人開発"], magazine: "マガジン名", thumbnail: "./thumbnail.png" });
    assert.equal(content, "\n本文");
  });
  it("YAML リスト(空行・コメント行・CRLF 込み)、引用符付きの値の後ろのコメント", () => {
    const { data } = fm('---\r\nhashtags:\r\n  - AI\r\n\r\n  # c\r\n  - "#個人開発"\r\nmagazine: "マガジン名" # 省略可\r\ntitle: t\r\n---\r\nx');
    assert.deepEqual(data, { hashtags: ["AI", "個人開発"], magazine: "マガジン名", title: "t" });
  });
  it("hashtags: #AI #個人開発(引用符なし)は README で許している書き方なので読める", () => {
    assert.deepEqual(fm("---\nhashtags: #AI #個人開発\n---\nx").data.hashtags, ["AI", "個人開発"]);
    assert.deepEqual(fm('---\nhashtags: "a, b" # c\n---\nx').data.hashtags, ["a", "b"]);
    assert.deepEqual(fm("---\nhashtags: a b　c、d\n---\nx").data.hashtags, ["a", "b", "c", "d"]);
  });
  it("null / ~ / コメントだけ / 空 は「無し」。数値は文字列に", () => {
    const { data } = fm("---\nmagazine: ~\nthumbnail: null\nhashtags: # なし\ntitle: 2026\n---\nx");
    assert.deepEqual(data, { title: "2026" });
  });
  it("ブロックスカラー(>- / |-)、エスケープ(\\u \\\" '')を YAML どおりに読む", () => {
    const { data } = fm(['---', "title: >-", "  long", "  title", "magazine: 'Author''s notes'", 'thumbnail: "\\u65e5\\u672c.png"', "---", "x"].join("\n"));
    assert.deepEqual(data, { title: "long title", magazine: "Author's notes", thumbnail: "日本.png" });
  });
  it("空の front matter は直後の --- で閉じる。本文の --- まで取り込まない", () => {
    const src = "---\n---\n# My title\n\n導入文\n\n---\n\n残りの本文";
    assert.deepEqual(fm(src), { data: {}, content: "# My title\n\n導入文\n\n---\n\n残りの本文" });
  });
  it("front matter が無ければそのまま。YAML として壊れていればエラー", () => {
    assert.deepEqual(fm("# t\n\nx"), { data: {}, content: "# t\n\nx" });
    assert.throws(() => fm("---\nhashtags: [a\ntitle: t\n---\nx"), /front matter が YAML として読めません/);
  });
  it("splitList はカンマ・空白・読点・# を受け付ける", () => {
    assert.deepEqual(splitList("#a, b　c、d"), ["a", "b", "c", "d"]);
    assert.deepEqual(splitList("[\"a\", 'b']"), ["a", "b"]);
  });
});

describe("renderArticle", () => {
  it("title は front matter 優先。本文の # 見出しはそのまま残る", async () => {
    const a = await renderArticle("---\ntitle: FM\nhashtags: a, b\n---\n# H1\n\n本文", convert);
    assert.equal(a.title, "FM");
    assert.deepEqual(a.hashtags, ["a", "b"]);
    assert.ok(a.html.includes("<h1>H1</h1>"), a.html);
  });
  it("title が無ければ最初の # 見出しを使い、本文からは落とす", async () => {
    const a = await renderArticle("# H1\n\n本文 **太字**", convert);
    assert.equal(a.title, "H1");
    assert.ok(!a.html.includes("<h1>"), a.html);
    assert.ok(a.html.includes("<strong>太字</strong>"), a.html);
  });
  it("override はすべてに優先し、空文字は無視する", async () => {
    const a = await renderArticle("---\ntitle: FM\nhashtags: [a]\nmagazine: M\n---\nx", convert, { title: "OV", hashtags: "#p #q", magazine: "  " });
    assert.equal(a.title, "OV");
    assert.deepEqual(a.hashtags, ["p", "q"]);
    assert.equal(a.magazine, "M");
  });
  it("final: 欄の値が最終。空にしたハッシュタグ・マガジンは front matter に戻らず「なし」", async () => {
    const a = await renderArticle("---\ntitle: FM\nhashtags: [a]\nmagazine: M\n---\nx", convert, {
      title: "FM",
      hashtags: "",
      magazine: "",
      final: true,
    });
    assert.equal(a.title, "FM");
    assert.deepEqual(a.hashtags, []);
    assert.equal(a.magazine, undefined);
  });
  it("final: 本文の # 見出しをそのままタイトル欄に出した場合は、本文から見出しを落とす", async () => {
    const a = await renderArticle("# H1\n\n本文", convert, { title: "H1", hashtags: "", magazine: "", final: true });
    assert.equal(a.title, "H1");
    assert.ok(!a.html.includes("<h1>"), a.html);
  });
  it("final: 見出しと違うタイトルに直した場合は、本文の見出しは残す", async () => {
    const a = await renderArticle("# H1\n\n本文", convert, { title: "別のタイトル", hashtags: "", magazine: "", final: true });
    assert.equal(a.title, "別のタイトル");
    assert.ok(a.html.includes("<h1>"), a.html);
  });
  it("final: タイトル欄が空ならエラー(front matter には戻らない)", async () => {
    await assert.rejects(() => renderArticle("---\ntitle: FM\n---\nx", convert, { title: "", final: true }), /タイトル/);
  });
  it("タイトルがどこにも無ければエラー", async () => {
    await assert.rejects(() => renderArticle("本文だけ", convert), /タイトル/);
  });
  it("thumbnail は相対パスのまま返す(解決は呼び出し側)", async () => {
    const a = await renderArticle("---\ntitle: t\nthumbnail: ./a.png\n---\nx", convert);
    assert.equal(a.thumbnail, "./a.png");
  });
});

describe("price(有料記事の価格)", () => {
  it("数字と、数字だけの文字列を受け付ける", () => {
    assert.equal(fm("---\nprice: 300\n---\nx").data.price, 300);
    assert.equal(fm('---\nprice: "300"\n---\nx').data.price, 300);
    assert.equal(fm("---\nprice: ' 500 '\n---\nx").data.price, 500);
    assert.equal(parsePrice("300"), 300);
  });
  it("書かない・空は「無し」(無料のまま)", () => {
    assert.equal("price" in fm("---\ntitle: t\n---\nx").data, false);
    assert.equal("price" in fm("---\nprice:\n---\nx").data, false);
    assert.equal("price" in fm("---\nprice: ~\n---\nx").data, false);
    assert.equal("price" in fm('---\nprice: ""\n---\nx').data, false);
    assert.equal(parsePrice(""), undefined);
    assert.equal(parsePrice("  "), undefined);
  });
  it("0・負・小数・文字は、front matter では止めずに直し方と元の値を残し、ほかの項目は読む", () => {
    for (const v of ["0", "-300", "300.5", "abc", "300円", "'-1'", "[300]", "true"]) {
      const { data } = fm(`---\ntitle: t\nhashtags: [a, b]\nmagazine: m\nprice: ${v}\n---\nx`);
      assert.match(data.priceError ?? "", /price は 1 以上の整数\(円\)で書いてください\(例: price: 300\)/, v);
      assert.ok(data.priceRaw, v);
      assert.equal("price" in data, false, v);
      assert.deepEqual([data.title, data.hashtags, data.magazine], ["t", ["a", "b"], "m"], v);
    }
    assert.equal(fm("---\nprice: 300円\n---\nx").data.priceRaw, "300円");
    for (const v of ["0", "-1", "1.5", "三百", "300 円"]) assert.throws(() => parsePrice(v), /price は 1 以上の整数/, v);
  });
  it("renderArticle は front matter の price を返す。無ければ price は無い", async () => {
    assert.equal((await renderArticle("---\ntitle: t\nprice: 300\n---\nx", convert)).price, 300);
    assert.equal("price" in (await renderArticle("---\ntitle: t\n---\nx", convert)), false);
  });
  it("override: 空なら front matter の値。final なら欄の値が最終で、空は無料のまま", async () => {
    const src = "---\ntitle: t\nprice: 300\n---\nx";
    assert.equal((await renderArticle(src, convert, { price: " " })).price, 300);
    assert.equal((await renderArticle(src, convert, { price: "500" })).price, 500);
    assert.equal((await renderArticle(src, convert, { title: "t", price: "500", final: true })).price, 500);
    assert.equal((await renderArticle(src, convert, { title: "t", price: "", final: true })).price, undefined);
    await assert.rejects(() => renderArticle(src, convert, { title: "t", price: "0", final: true }), /price は 1 以上の整数/);
  });
  it("front matter の price が正しくないとき: 欄の値(final)で直せば送れる。欄を使わないときはエラー", async () => {
    const bad = "---\ntitle: t\nprice: 300円\n---\nx";
    assert.equal((await renderArticle(bad, convert, { title: "t", price: "300", final: true })).price, 300);
    assert.equal((await renderArticle(bad, convert, { title: "t", price: "", final: true })).price, undefined);
    await assert.rejects(() => renderArticle(bad, convert, { title: "t", price: "300円", final: true }), /price は 1 以上の整数/);
    await assert.rejects(() => renderArticle(bad, convert), /price は 1 以上の整数/);
    assert.equal((await renderArticle(bad, convert, { price: "500" })).price, 500);
  });
});

describe("target(入れる先)", () => {
  it("front matter の target を読み、renderArticle が返す。書かなければ無い", async () => {
    assert.equal(parseFrontMatter("---\ntarget: library\n---\n本文", parseYaml).data.target, "library");
    assert.equal(parseFrontMatter("---\ntitle: T\n---\n本文", parseYaml).data.target, undefined);
    const conv = { markdown: (b: string) => md.parse(b) as string, yaml: parseYaml };
    assert.equal((await renderArticle("---\ntitle: T\ntarget: library\n---\n本文", conv)).target, "library");
    assert.equal((await renderArticle("---\ntitle: T\n---\n本文", conv)).target, undefined);
  });

  it("note に入れるとき: target が無い・note(大文字小文字・前後の空白は問わない)なら通す。それ以外は止め、直し方を出す", () => {
    for (const t of [undefined, "", "note", "Note", " NOTE "]) assert.doesNotThrow(() => checkTarget(t, "note"), String(t));
    assert.throws(() => checkTarget("library", "note"), /target: library」と書いてあるので、note の下書きは作りません/);
    assert.throws(() => checkTarget("other", "note"), /target の行を消すか「target: note」/);
  });

  it("今開いている追加の対応先のページに入れるとき: target: note だけ止める。無い・ほかの値は通す", () => {
    for (const t of [undefined, "", "library", "other"]) assert.doesNotThrow(() => checkTarget(t, "extra-site"), String(t));
    assert.throws(() => checkTarget("note", "extra-site"), /target: note」と書いてあるので、今開いているページには入れません/);
  });
});
