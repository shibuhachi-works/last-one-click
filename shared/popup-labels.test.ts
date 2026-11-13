// 拡張のポップアップの案内(popup.ts の文)に出てくるボタンの名前が、popup.html に実在するボタンの文字と一致するかを確かめる。
// ボタンの名前を変えたのに、案内の文だけ古い名前(例「組み立てる」)のまま残るのを防ぐ。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const html = readFileSync(new URL("../extension/src/popup.html", import.meta.url), "utf8");
const ts = readFileSync(new URL("../extension/src/popup.ts", import.meta.url), "utf8");

/** popup.html のボタンの文字(前後の空白は除く) */
const buttonLabels = new Set(Array.from(html.matchAll(/<button\b[^>]*>([^<]+)<\/button>/g), (m) => m[1].trim()));

/** popup.ts の案内で、ボタンとして名前を出しているもの(「〜」を押す・「〜」で選ぶ)。${…} で入れる名前は除く */
function labelsInMessages(src: string): string[] {
  return Array.from(src.matchAll(/「([^」$]+)」(?:を押|で選)/g), (m) => m[1]);
}

describe("ポップアップの案内に出てくるボタンの名前", () => {
  it("popup.html にボタンがある(このテスト自体が空振りしていない)", () => {
    assert.ok(buttonLabels.size >= 5, `ボタンが少なすぎます: ${[...buttonLabels].join(", ")}`);
    assert.ok(labelsInMessages(ts).length > 0, "案内の文からボタンの名前を 1 つも拾えていません");
  });

  it("案内の文に書いたボタンの名前は、すべて popup.html に実在する", () => {
    const missing = labelsInMessages(ts).filter((l) => !buttonLabels.has(l));
    assert.deepEqual(missing, [], `popup.html に無いボタンの名前が案内に残っています: ${missing.join(", ")}`);
  });

  it("「note の下書きを作成」ボタンの名前は submitLabel() から入れ、控えの文字も #submit と同じ", () => {
    const submit = html.match(/<button\b[^>]*\bid="submit"[^>]*>([^<]+)<\/button>/)?.[1].trim();
    assert.ok(submit, "popup.html に #submit のボタンがありません");
    const fallback = ts.match(/const submitLabel = \(\) => \$\("submit"\)\.textContent\?\.trim\(\) \|\| "([^"]+)"/)?.[1];
    assert.equal(fallback, submit, "submitLabel() の控えの文字が #submit のボタンの文字と違います");
    // 名前をじかに書かず、submitLabel() を使う
    assert.ok(!ts.includes(`「${submit}」を押`), `案内に「${submit}」をじかに書かず、submitLabel() を使ってください`);
  });
});
