import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { articleOptionsLabel } from "./article-options.js";

describe("articleOptionsLabel", () => {
  it("オンのものを並べる", () => {
    assert.equal(articleOptionsLabel({ toc: true, embed: true }), "(目次・埋め込み)");
    assert.equal(articleOptionsLabel({ toc: false, embed: true }), "(埋め込み)");
    assert.equal(articleOptionsLabel({ toc: true, embed: true, images: true }), "(目次・埋め込み・画像)");
    assert.equal(articleOptionsLabel({ toc: false, embed: false, images: true, skipReview: true }), "(画像・公開設定まで進む)");
  });
  it("全部オフなら「なし」", () => {
    assert.equal(articleOptionsLabel({ toc: false, embed: false }), "(なし)");
  });
});
