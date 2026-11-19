// ストアに出ている拡張は、起動のたびに main の selectors/note.json を読む(extension/src/lib/selectors.ts の DEFAULT_SELECTORS_URL)。
// だから main の note.json は、出ている版の読み込み処理でも読めなければならない。
// 写し shared/released/selectors-schema.v<版>.ts は、ストアに新しい版が出たら置き換える(docs/store-submission.md)。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validateSelectorsJson as validateReleased } from "./released/selectors-schema.v0.1.5.js";
import { validateSelectorsJson as validateCurrent } from "./selectors-schema.js";

const RELEASED = "v0.1.5";
const noteJson = JSON.parse(readFileSync(new URL("../selectors/note.json", import.meta.url), "utf8"));

describe(`selectors/note.json をストアに出ている版(${RELEASED})の読み込み処理で読む`, () => {
  it("エラーにならない", () => {
    assert.doesNotThrow(() => validateReleased(noteJson));
  });

  it("出ている版が読む項目の値は、今の読み込み処理で読んだ値と同じ(今ある項目の値を書き換えていない)", () => {
    const released = validateReleased(noteJson) as unknown as Record<string, unknown>;
    const current = validateCurrent(noteJson) as unknown as Record<string, unknown>;
    // 出ている版が返す項目(入れ子は 1 段まで)を、ひとつずつ比べる。今の版で増えた項目は比べない
    for (const [key, value] of Object.entries(released)) {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const cur = current[key] as Record<string, unknown> | undefined;
        assert.ok(cur && typeof cur === "object", `${key} が今の読み込み処理の結果に無い`);
        for (const [sub, subValue] of Object.entries(value as Record<string, unknown>)) {
          assert.deepEqual(cur[sub], subValue, `${key}.${sub} の値が出ている版と違う`);
        }
      } else {
        assert.deepEqual(current[key], value, `${key} の値が出ている版と違う`);
      }
    }
  });

  it("比べる項目に title・body・thumbnail・publishSettings が入っている", () => {
    const released = validateReleased(noteJson);
    for (const key of ["title", "body", "thumbnail", "publishSettings"] as const) assert.ok(key in released, key);
    for (const sub of ["hashtagInput", "magazineToggleText", "magazineItem", "magazineAddButtonText", "publishButtonText"] as const) {
      assert.ok(sub in released.publishSettings, `publishSettings.${sub}`);
    }
  });
});
