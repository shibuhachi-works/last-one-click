import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Marked } from "marked";
import {
  MAX_BODY_IMAGES,
  findDroppedImage,
  imageFileName,
  imageMarker,
  isLocalImageSrc,
  localImageNamesInMarkdown,
  makeImageRenderer,
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
    assert.equal(imageMarker(3, "./images/fig.png"), "［画像3: fig.png］");
  });

  it("makeImageRenderer: 相対パスの画像は目印に、URL の画像はこれまでどおり <img> に", () => {
    const refs: BodyImageRef[] = [];
    const md = new Marked({ gfm: true, renderer: { ...SAFE_RENDERER, image: makeImageRenderer(refs, SAFE_RENDERER.image) } as never });
    const html = md.parse("前の文\n\n![図1](fig1.png)\n\n文の中 ![図2](./img/fig2.png) です\n\n![外](https://example.com/a.png)\n\n`![コード](x.png)`\n") as string;
    assert.match(html, /<p>［画像1: fig1\.png］<\/p>/);
    assert.match(html, /文の中 ［画像2: fig2\.png］ です/);
    assert.match(html, /<img src="https:\/\/example\.com\/a\.png" alt="外">/);
    assert.match(html, /<code>!\[コード\]\(x\.png\)<\/code>/, "コードの中は画像にしない");
    assert.deepEqual(
      refs.map((r) => [r.marker, r.src, r.alt]),
      [
        ["［画像1: fig1.png］", "fig1.png", "図1"],
        ["［画像2: fig2.png］", "./img/fig2.png", "図2"],
      ],
    );
  });

  it("目印のファイル名に HTML の特殊文字があっても、文字のまま出す", () => {
    const refs: BodyImageRef[] = [];
    const md = new Marked({ renderer: { ...SAFE_RENDERER, image: makeImageRenderer(refs, SAFE_RENDERER.image) } as never });
    const html = md.parse("![x](<a<b>.png>)") as string;
    assert.ok(!html.includes("<b>"), html);
  });

  it("findDroppedImage: ドロップされた画像を、ファイル名(大文字・小文字は区別しない)で探す", () => {
    const files = [{ name: "Fig1.PNG" }, { name: "other.png" }];
    assert.equal(findDroppedImage(files, "./images/fig1.png")?.name, "Fig1.PNG");
    assert.equal(findDroppedImage(files, "missing.png"), undefined);
  });

  it("localImageNamesInMarkdown: md に相対パスで書いた画像のファイル名を集める(URL の画像は除く)", () => {
    const names = localImageNamesInMarkdown("![a](fig1.png)\n![b](./img/Fig2.JPG \"t\")\n![c](https://x/y.png)\n");
    assert.deepEqual([...names].sort(), ["fig1.png", "fig2.jpg"]);
  });

  it("上限は 20 枚", () => {
    assert.equal(MAX_BODY_IMAGES, 20);
  });
});
