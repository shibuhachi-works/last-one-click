import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { articleOptionsLabel } from "./article-options.js";

describe("articleOptionsLabel", () => {
  it("オンのものを並べる", () => {
    assert.equal(articleOptionsLabel({ toc: true, embed: true, credit: true }), "(目次・埋め込み・リンク)");
    assert.equal(articleOptionsLabel({ toc: false, embed: true, credit: false }), "(埋め込み)");
  });
  it("全部オフなら「なし」", () => {
    assert.equal(articleOptionsLabel({ toc: false, embed: false, credit: false }), "(なし)");
  });
});
