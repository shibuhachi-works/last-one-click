import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasTocHeadings } from "./toc.js";

describe("hasTocHeadings", () => {
  it("h2・h3 があれば true", () => {
    assert.equal(hasTocHeadings("<h2>見出し</h2><p>本文</p>"), true);
    assert.equal(hasTocHeadings('<p>本文</p><h3 id="x">小見出し</h3>'), true);
  });
  it("見出しが無い、または h4 以下・文字としての <h2> だけなら false", () => {
    assert.equal(hasTocHeadings("<p>本文だけ</p>"), false);
    assert.equal(hasTocHeadings("<h4>小さい見出し</h4>"), false);
    assert.equal(hasTocHeadings("<p>&lt;h2&gt;は文字</p>"), false);
    assert.equal(hasTocHeadings("<hr><p>区切り線</p>"), false);
  });
});
