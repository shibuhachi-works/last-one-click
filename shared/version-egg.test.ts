import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VERSION_EGG_MESSAGE, nextTapCount, versionTapMessage } from "./version-egg.js";

describe("版の文字を続けて押したときの一言(#198)", () => {
  it("3 回目までは何も出さず、4〜6 回目は残りの回数、7 回目で一言を出す", () => {
    assert.deepEqual([1, 2, 3].map(versionTapMessage), [null, null, null]);
    assert.deepEqual([4, 5, 6].map(versionTapMessage), ["あと 3 回", "あと 2 回", "あと 1 回"]);
    assert.equal(versionTapMessage(7), VERSION_EGG_MESSAGE);
    assert.equal(VERSION_EGG_MESSAGE, "最後のワンクリックは、あなたの手で。");
  });
  it("間が空いたら 1 から数え直す", () => {
    assert.equal(nextTapCount({ count: 3, at: 1_000 }, 2_000), 4);
    assert.equal(nextTapCount({ count: 3, at: 1_000 }, 5_000), 1);
    assert.equal(nextTapCount({ count: 0, at: 0 }, 10_000), 1);
  });
});
