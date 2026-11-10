import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Marked } from "marked";
import {
  MAX_BODY_IMAGES,
  findDroppedImage,
  imageFileName,
  imageMarker,
  isLocalImageSrc,
  base64Size,
  makeImageRenderer,
  makeMarkerTag,
  localImageNames,
  type BodyImageRef,
} from "./body-images.js";
import { SAFE_RENDERER } from "./markdown-safe.js";

describe("本文の画像(#51)", () => {
  it("isLocalImageSrc: ファイル名・相対パスだけを本文の画像として扱う", () => {
    for (const s of ["image1.png", "./image1.png", "images/a.png", "../a.jpg", "a b.png"]) assert.equal(isLocalImageSrc(s), true, s);
    for (const s of ["https://example.com/a.png", "http://x/a.png", "data:image/png;base64,AA", "//cdn/a.png", "/abs/a.png", "#x", "", "javascript:alert(1)"]) {
      assert.equal(isLocalImageSrc(s), false, s);
    }
  });

  it("imageFileName / imageMarker: 目印には番号とファイル名を入れる", () => {
    assert.equal(imageFileName("./images/a%20b.png"), "a b.png");
    assert.equal(imageFileName("x.png?raw=1"), "x.png");
    assert.equal(imageMarker(3, "./images/fig.png", "ab12"), "［画像3・ab12: fig.png］");
  });

  it("makeImageRenderer: 相対パスの画像は目印に、URL の画像はこれまでどおり <img> に", () => {
    const refs: BodyImageRef[] = [];
    const md = new Marked({ gfm: true, renderer: { ...SAFE_RENDERER, image: makeImageRenderer(refs, SAFE_RENDERER.image, "t0g0") } as never });
    const html = md.parse("前の文\n\n![図1](fig1.png)\n\n文の中 ![図2](./img/fig2.png) です\n\n![外](https://example.com/a.png)\n\n`![コード](x.png)`\n") as string;
    assert.match(html, /<p>［画像1・t0g0: fig1\.png］<\/p>/);
    assert.match(html, /文の中 ［画像2・t0g0: fig2\.png］ です/);
    assert.match(html, /<img src="https:\/\/example\.com\/a\.png" alt="外">/);
    assert.match(html, /<code>!\[コード\]\(x\.png\)<\/code>/, "コードの中は画像にしない");
    assert.deepEqual(
      refs.map((r) => [r.marker, r.src, r.alt]),
      [
        ["［画像1・t0g0: fig1.png］", "fig1.png", "図1"],
        ["［画像2・t0g0: fig2.png］", "./img/fig2.png", "図2"],
      ],
    );
  });

  it("![説明](a.png \"キャプション\") の \"…\"(title)は caption に入れる。title が無ければ caption は無し", () => {
    const refs: BodyImageRef[] = [];
    const md = new Marked({ renderer: { ...SAFE_RENDERER, image: makeImageRenderer(refs, SAFE_RENDERER.image, "t0g0") } as never });
    md.parse('![図](a.png "A &amp; B のキャプション")\n\n![図](b.png)\n');
    assert.equal(refs[0].caption, "A & B のキャプション");
    assert.equal(refs[1].caption, undefined);
  });

  it("目印のファイル名に HTML の特殊文字があっても、文字のまま出す", () => {
    const refs: BodyImageRef[] = [];
    const md = new Marked({ renderer: { ...SAFE_RENDERER, image: makeImageRenderer(refs, SAFE_RENDERER.image, "t0g0") } as never });
    const html = md.parse("![x](<a<b>.png>)") as string;
    assert.ok(!html.includes("<b>"), html);
  });

  it("findDroppedImage: ドロップされた画像を、ファイル名(大文字・小文字は区別しない)で探す", () => {
    const files = [{ name: "Fig1.PNG" }, { name: "other.png" }];
    assert.equal(findDroppedImage(files, "./images/fig1.png")?.name, "Fig1.PNG");
    assert.equal(findDroppedImage(files, "missing.png"), undefined);
  });

  it("makeMarkerTag: 目印の印は、記事の md に含まれない文字列にする(記事の中の同じ文字と取り違えないため)", () => {
    const seq = [0, 0, 0.5];
    let k = 0;
    const random = () => seq[k++];
    // 1 回目・2 回目の候補("0000")は md に含まれるので作り直す
    assert.equal(makeMarkerTag("本文に 0000 がある", random), Math.floor(0.5 * 36 ** 4).toString(36));
    assert.match(makeMarkerTag(""), /^[0-9a-z]{4}$/);
  });

  it("localImageNames: 本文の変換と同じ読み方で、相対パスの画像のファイル名を集める(<a b.png> や参照形式も)", () => {
    const md = "---\ntitle: t\nthumbnail: ./cover.png\n---\n\n![a](fig1.png)\n\n![b](<my figure.PNG>)\n\n![c][ref]\n\n![d](https://x/y.png)\n\n`![e](code.png)`\n\n[ref]: ./img/Ref.jpg\n";
    assert.deepEqual([...localImageNames(Marked as never, md, SAFE_RENDERER.image)].sort(), ["fig1.png", "my figure.png", "ref.jpg"]);
  });

  it("localImageNames: 空の front matter でも、本文の区切り線(---)より前の画像を落とさない", () => {
    const md = "---\n---\n\n![a](fig1.png)\n\n---\n\n![b](fig2.png)\n";
    assert.deepEqual([...localImageNames(Marked as never, md, SAFE_RENDERER.image)].sort(), ["fig1.png", "fig2.png"]);
  });

  it("画像の参照先の文字参照(&amp; など)は戻してからファイル名にする", () => {
    const refs: BodyImageRef[] = [];
    const md = new Marked({ renderer: { ...SAFE_RENDERER, image: makeImageRenderer(refs, SAFE_RENDERER.image, "t0g0") } as never });
    md.parse("![x](a&amp;b.png)");
    assert.equal(refs[0].src, "a&b.png");
    assert.deepEqual([...localImageNames(Marked as never, "![x](a&amp;b.png)\n", SAFE_RENDERER.image)], ["a&b.png"]);
  });

  it("base64Size: base64 にした大きさで数える(chrome.storage に入れる大きさ)", () => {
    assert.equal(base64Size(3), 4);
    assert.equal(base64Size(4), 8);
    assert.equal(base64Size(3 * 1024 * 1024), 4 * 1024 * 1024);
  });

  it("上限は 20 枚", () => {
    assert.equal(MAX_BODY_IMAGES, 20);
  });
});
