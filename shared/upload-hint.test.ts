import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gifUploadHint, hasGif } from "./upload-hint.js";

describe("gifUploadHint", () => {
  it("入らなかった画像に gif があれば、直し方を返す", () => {
    assert.match(gifUploadHint([{ name: "demo.gif", mimeType: "image/gif" }]), /YouTube/);
    assert.match(gifUploadHint([{ name: "a.png" }, { name: "DEMO.GIF" }]), /gif を小さく/);
  });
  it("gif が無ければ空文字", () => {
    assert.equal(gifUploadHint([{ name: "a.png", mimeType: "image/png" }]), "");
    assert.equal(gifUploadHint([]), "");
  });
  it("mimeType だけが gif でも見つける", () => {
    assert.equal(hasGif([{ name: "image1", mimeType: "image/gif" }]), true);
  });
});
