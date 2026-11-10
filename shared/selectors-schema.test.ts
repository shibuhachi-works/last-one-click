import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DEFAULT_TOC, SelectorsValidationError, isAllowedNoteUrl, validateSelectorsJson } from "./selectors-schema.js";

const bundled = JSON.parse(readFileSync(new URL("../selectors/note.json", import.meta.url), "utf8"));
const clone = () => JSON.parse(JSON.stringify(bundled));

describe("validateSelectorsJson", () => {
  it("同梱の selectors/note.json は通る", () => {
    const v = validateSelectorsJson(bundled);
    assert.equal(v.newNoteUrl, bundled.newNoteUrl);
    assert.equal(v.publishSettings.publishButtonText.length, bundled.publishSettings.publishButtonText.length);
  });

  it("省略できるキー(thumbnail.uploadMenuText / publishSettings.magazineAddButtonText)は既定値になる", () => {
    const j = clone();
    delete j.thumbnail.uploadMenuText;
    delete j.publishSettings.magazineAddButtonText;
    const v = validateSelectorsJson(j);
    assert.deepEqual(v.thumbnail.uploadMenuText, ["画像をアップロード"]);
    assert.deepEqual(v.publishSettings.magazineAddButtonText, ["追加"]);
  });

  it("toc は省略できる(古い selectors でも既定値で目次を入れられる)", () => {
    const j = clone();
    delete j.toc;
    assert.deepEqual(validateSelectorsJson(j).toc, DEFAULT_TOC);
  });

  it("同梱の toc は「+」(メニューを開く)と「目次」のボタンを指す", () => {
    const v = validateSelectorsJson(bundled);
    assert.equal(v.toc.openMenuButton, 'button[aria-label="メニューを開く"]');
    assert.equal(v.toc.itemSelector, "#toc-setting");
    assert.deepEqual(v.toc.itemText, ["目次"]);
  });

  it("toc の中身が空なら通さない", () => {
    const j = clone();
    j.toc.itemText = [];
    assert.throws(() => validateSelectorsJson(j), SelectorsValidationError);
  });

  it("newNoteUrl が note 以外(フィッシング)なら通さない", () => {
    for (const bad of [
      "https://note.com.evil.example/notes/new",
      "https://evil.example/note.com/notes/new",
      "http://note.com/notes/new",
      "javascript:alert(1)",
      "chrome://extensions",
      "",
    ]) {
      const j = clone();
      j.newNoteUrl = bad;
      assert.throws(() => validateSelectorsJson(j), SelectorsValidationError, bad);
    }
  });

  it("editor.note.com は通る", () => {
    const j = clone();
    j.newNoteUrl = "https://editor.note.com/new";
    assert.doesNotThrow(() => validateSelectorsJson(j));
  });

  it("loginUrlPattern が正規表現として不正・長すぎるなら通さない", () => {
    const j = clone();
    j.loginUrlPattern = "(";
    assert.throws(() => validateSelectorsJson(j), SelectorsValidationError);
    j.loginUrlPattern = "a".repeat(201);
    assert.throws(() => validateSelectorsJson(j), SelectorsValidationError);
  });

  it("キーが無い・型が違う・空配列は通さない", () => {
    const cases: [(j: any) => void, string][] = [
      [(j) => delete j.title, "title 無し"],
      [(j) => (j.body = 123), "body が数値"],
      [(j) => (j.thumbnail = "x"), "thumbnail が文字列"],
      [(j) => (j.openPublishSettingsText = []), "空配列"],
      [(j) => (j.publishSettings.publishButtonText = ["ok", 1]), "配列に数値"],
      [(j) => (j.version = "1"), "version が文字列"],
    ];
    for (const [mutate, name] of cases) {
      const j = clone();
      mutate(j);
      assert.throws(() => validateSelectorsJson(j), SelectorsValidationError, name);
    }
  });

  it("オブジェクト以外は通さない", () => {
    for (const bad of [null, undefined, "str", [], 1]) {
      assert.throws(() => validateSelectorsJson(bad), SelectorsValidationError);
    }
  });

  it("余分なキーは落として返す(そのまま通さない)", () => {
    const j = clone();
    j.extra = "x";
    const v = validateSelectorsJson(j) as any;
    assert.equal(v.extra, undefined);
  });
});

describe("isAllowedNoteUrl", () => {
  it("note.com / editor.note.com の https のみ", () => {
    assert.equal(isAllowedNoteUrl("https://note.com/notes/new"), true);
    assert.equal(isAllowedNoteUrl("https://editor.note.com/x"), true);
    assert.equal(isAllowedNoteUrl("https://www.note.com/"), false);
    assert.equal(isAllowedNoteUrl("http://note.com/"), false);
    assert.equal(isAllowedNoteUrl("not a url"), false);
  });
});
