// 記事の note_account と、ログイン中のアカウントの比べ方(#102)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";
import { Marked } from "marked";
import { parseFrontMatter, renderArticle } from "./article.js";
import { checkNoteAccount, noteAccountMismatchMessage, noteAccountUnknownMessage, normalizeNoteAccount, sameNoteAccount } from "./note-account.js";
import { SAFE_RENDERER } from "./markdown-safe.js";

const fm = (s: string) => parseFrontMatter(s, parseYaml).data;
const md = new Marked({ gfm: true, breaks: true, renderer: SAFE_RENDERER as never });
const convert = { markdown: (s: string) => md.parse(s) as string, yaml: parseYaml };

describe("front matter の note_account", () => {
  it("書けば読む。無いときは無し(今までどおり)", () => {
    assert.equal(fm("---\ntitle: t\nnote_account: example\n---\n本文").noteAccount, "example");
    assert.equal(fm("---\ntitle: t\n---\n本文").noteAccount, undefined);
    assert.equal(fm("本文だけ").noteAccount, undefined);
  });
  it("空・null は無し", () => {
    assert.equal(fm("---\nnote_account:\n---\n").noteAccount, undefined);
    assert.equal(fm('---\nnote_account: ""\n---\n').noteAccount, undefined);
    assert.equal(fm('---\nnote_account: "   "\n---\n').noteAccount, undefined);
    assert.equal(fm('---\nnote_account: "@"\n---\n').noteAccount, undefined);
  });
  it("前後の空白と先頭の @ は外す。大文字と小文字は書いたまま残す(比べるときに区別しない)", () => {
    assert.equal(fm('---\nnote_account: "  example  "\n---\n').noteAccount, "example");
    assert.equal(fm('---\nnote_account: "@Example"\n---\n').noteAccount, "Example");
  });
  it("renderArticle の結果にも入る。無ければ入らない", async () => {
    assert.equal((await renderArticle("---\ntitle: t\nnote_account: example\n---\n本文", convert)).noteAccount, "example");
    assert.ok(!("noteAccount" in (await renderArticle("---\ntitle: t\n---\n本文", convert))));
  });
});

describe("normalizeNoteAccount / sameNoteAccount", () => {
  it("揃え方", () => {
    assert.equal(normalizeNoteAccount(undefined), undefined);
    assert.equal(normalizeNoteAccount(" @ab_c "), "ab_c");
  });
  it("大文字と小文字は区別しない", () => {
    assert.equal(sameNoteAccount("Example", "example"), true);
    assert.equal(sameNoteAccount("example", "example2"), false);
  });
});

describe("checkNoteAccount", () => {
  const me = { name: "見本の書き手", id: "sample_writer" };
  it("指定が無ければ比べない", () => {
    assert.deepEqual(checkNoteAccount(undefined, me), { kind: "none" });
    assert.deepEqual(checkNoteAccount("", null), { kind: "none" });
  });
  it("同じなら進む(大文字と小文字・先頭の @ は区別しない)", () => {
    assert.deepEqual(checkNoteAccount("sample_writer", me), { kind: "match", expected: "sample_writer" });
    assert.deepEqual(checkNoteAccount("@Sample_Writer", me), { kind: "match", expected: "Sample_Writer" });
  });
  it("違えば止める", () => {
    const c = checkNoteAccount("other_writer", me);
    assert.deepEqual(c, { kind: "mismatch", expected: "other_writer", current: "sample_writer" });
    assert.equal(
      noteAccountMismatchMessage(c as Extract<typeof c, { kind: "mismatch" }>),
      "ログイン中のアカウント(sample_writer)が、記事の指定(other_writer)と違います。note でアカウントを切り替えてから、もう一度作成してください。",
    );
  });
  it("読めない(null)・ID が無いときは、止めずに注意する", () => {
    const c = checkNoteAccount("sample_writer", null);
    assert.deepEqual(c, { kind: "unknown", expected: "sample_writer" });
    assert.deepEqual(checkNoteAccount("sample_writer", { name: "名前だけ" }), { kind: "unknown", expected: "sample_writer" });
    assert.match(noteAccountUnknownMessage(c as Extract<typeof c, { kind: "unknown" }>), /^アカウントを確かめられませんでした/);
  });
});
