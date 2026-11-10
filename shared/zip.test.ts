import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBundleFile, readZip } from "./zip.js";
import { makeZip } from "./zip-fixture.test.js";

const text = (d: Uint8Array) => new TextDecoder().decode(d);

describe("readZip(記事の ZIP)", () => {
  it("deflate と無圧縮の md・画像を取り出し、使わないファイル・隠しファイル・__MACOSX は飛ばす", async () => {
    const zip = makeZip([
      { name: "post/article.md", data: "# タイトル\n\n本文".repeat(50) },
      { name: "post/image1.png", data: new Uint8Array([1, 2, 3, 4]), store: true },
      { name: "post/notes.txt", data: "使わない" },
      { name: "post/.DS_Store", data: "x" },
      { name: "__MACOSX/post/._image1.png", data: "x" },
      { name: "post/", data: "", store: true },
    ]);
    const out = await readZip(zip);
    assert.deepEqual(out.map((e) => e.path), ["post/article.md", "post/image1.png"]);
    assert.equal(text(out[0].data), "# タイトル\n\n本文".repeat(50));
    assert.deepEqual([...out[1].data], [1, 2, 3, 4]);
  });

  it("UTF-8 の印が無いファイル名は、Shift_JIS としても読む(日本語の Windows で作った ZIP)", async () => {
    // 「図.png」の Shift_JIS
    const sjis = new Uint8Array([0x90, 0x7d, 0x2e, 0x70, 0x6e, 0x67]);
    const out = await readZip(makeZip([{ name: "", nameBytes: sjis, utf8Flag: false, data: "x", store: true }]));
    assert.equal(out[0].path, "図.png");
  });

  it("壊れた ZIP・書かれた大きさより大きく展開される ZIP はエラーにする", async () => {
    await assert.rejects(readZip(new Uint8Array([1, 2, 3])), /ZIP ファイルとして読めません/);
    const lie = makeZip([{ name: "a.md", data: "a".repeat(10_000), sizeOverride: 10 }]);
    await assert.rejects(readZip(lie), /壊れています/);
  });

  it("isBundleFile: md と画像だけ", () => {
    for (const p of ["a.md", "x/y.MARKDOWN", "i.png", "i.JPG", "i.jpeg", "i.gif", "i.webp"]) assert.equal(isBundleFile(p), true, p);
    for (const p of ["a.txt", "a.zip", ".hidden.md", "x/.git/a.md", "__MACOSX/a.png"]) assert.equal(isBundleFile(p), false, p);
  });
});
