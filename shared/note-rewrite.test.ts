import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";
import { parseFrontMatter } from "./article.js";
import { REWRITE_UNDO_NOTE, checkNoteUrl, noteEditKey, noteUrlKey, noteUrlProblem, rewriteSkippedLines } from "./note-rewrite.js";

describe("noteEditKey(書き換えられる編集画面か)", () => {
  it("すでにある記事の編集画面なら記事の ID", () => {
    assert.equal(noteEditKey("https://editor.note.com/notes/n0123abcd/edit/"), "n0123abcd");
    assert.equal(noteEditKey("https://editor.note.com/notes/n0123abcd/edit"), "n0123abcd");
    assert.equal(noteEditKey("https://note.com/notes/n0123abcd/edit"), "n0123abcd");
    assert.equal(noteEditKey("https://editor.note.com/notes/n0123abcd/edit/?x=1#top"), "n0123abcd");
  });
  it("新規作成・ほかのページ・ほかのサイトは null", () => {
    for (const url of [
      "https://editor.note.com/notes/new",
      "https://note.com/notes/new/edit",
      "https://editor.note.com/notes/n0123abcd/publish/",
      "https://note.com/someone/n/n0123abcd",
      "https://example.com/notes/n0123abcd/edit",
      "http://editor.note.com/notes/n0123abcd/edit",
      "chrome-extension://abc/popup.html",
      undefined,
      "",
    ]) {
      assert.equal(noteEditKey(url), null, String(url));
    }
  });
});

describe("noteUrlKey(front matter の note_url)", () => {
  it("記事のページと編集画面の URL を読む", () => {
    assert.equal(noteUrlKey("https://note.com/someone/n/n0123abcd"), "n0123abcd");
    assert.equal(noteUrlKey("https://note.com/someone/n/n0123abcd/"), "n0123abcd");
    assert.equal(noteUrlKey(" https://editor.note.com/notes/n0123abcd/edit/ "), "n0123abcd");
  });
  it("読めなければ null", () => {
    for (const v of [undefined, "", "n0123abcd", "https://note.com/someone", "https://example.com/someone/n/n0123abcd", "https://note.com/someone/n/"]) {
      assert.equal(noteUrlKey(v), null, String(v));
    }
  });
});

describe("checkNoteUrl・noteUrlProblem", () => {
  it("書いていなければ比べない。同じなら書き換える", () => {
    assert.deepEqual(checkNoteUrl(undefined, "n1"), { kind: "none" });
    assert.deepEqual(checkNoteUrl("https://note.com/a/n/n1", "n1"), { kind: "match" });
    assert.equal(noteUrlProblem(checkNoteUrl(undefined, "n1")), null);
    assert.equal(noteUrlProblem(checkNoteUrl("https://note.com/a/n/n1", "n1")), null);
  });
  it("違う記事・読めない値なら書き換えない理由を返す", () => {
    assert.match(noteUrlProblem(checkNoteUrl("https://note.com/a/n/n2", "n1")) ?? "", /n2.*n1.*違います/);
    assert.match(noteUrlProblem(checkNoteUrl("どこか", "n1")) ?? "", /読めません/);
  });
});

describe("rewriteSkippedLines(書き換えでは入れないもの)", () => {
  it("ハッシュタグ・マガジン・価格・有料ラインを並べる", () => {
    assert.deepEqual(rewriteSkippedLines({ hashtags: ["a", "b"], magazine: "m", price: 300, paywallAnchor: "x" }), [
      "md のハッシュタグ: #a #b",
      "md のマガジン: m",
      "md の価格: 300 円",
      "md の有料ライン(「ここから有料」の印)",
    ]);
    assert.deepEqual(rewriteSkippedLines({ hashtags: [] }), []);
  });
  it("元に戻し方は「保存せずに閉じる」", () => {
    assert.match(REWRITE_UNDO_NOTE, /保存せずに閉じれば、元のまま/);
  });
});

describe("front matter の note_url", () => {
  it("読む(前後の空白は外す)。無ければ無い", () => {
    assert.equal(parseFrontMatter("---\nnote_url: \" https://note.com/a/n/n1 \"\n---\n本文", parseYaml).data.noteUrl, "https://note.com/a/n/n1");
    assert.equal(parseFrontMatter("---\ntitle: x\n---\n本文", parseYaml).data.noteUrl, undefined);
  });
});
