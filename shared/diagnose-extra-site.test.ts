// 追加の対応先の診断で、URL と文字の中の ID・メールアドレスを伏せることを確かめる(#118)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mask, maskPath } from "../extension/src/lib/diagnose-extra-site.js";

describe("診断の伏せ字", () => {
  it("パスの数字を含む部分・長い部分を *** にする", () => {
    assert.equal(maskPath("/articles/new"), "/articles/new");
    assert.equal(maskPath("/articles/123/edit"), "/articles/***/edit");
    assert.equal(maskPath("/posts/a1b2c3/edit"), "/posts/***/edit");
    assert.equal(maskPath("/edit/abcdefghijklmnopqrstuvwxyz"), "/edit/***");
    assert.equal(maskPath("/"), "/");
  });

  it("4 桁以上の数字とメールアドレスの形を伏せる", () => {
    assert.equal(mask("user-12345"), "user-***");
    assert.equal(mask("h2 v123"), "h2 v123");
    assert.equal(mask("連絡 someone@example.com まで"), "連絡 ***@*** まで");
  });
});
