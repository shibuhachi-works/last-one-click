// 追加の対応先のエディタの診断(extension/src/lib/diagnose-extra-site.ts。#118)を、見本の DOM で確かめる。
// 入力欄とボタンの道筋が出ること、タイトル・本文・アカウントの名前や ID がレポートに入らないこと、読むだけであること
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildSync } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

const PAGE = `<!doctype html><html><head><title>ひみつの記事タイトル</title></head><body>
  <header>
    <button type="button" class="user-menu" data-user-id="9876543"><img src="https://example.com/me.png" alt="">ひみつの名前</button>
    <a href="/users/9876543">ひみつの名前</a>
    <button type="button" aria-label="ひみつの名前のメニュー" title="ひみつの名前"><img src="https://example.com/me.png" alt="ひみつの別名"></button>
    <div class="avatar-area"><button type="button" aria-label="ひみつの愛称">▼</button></div>
    <button type="button" aria-label="ひみつの愛称の設定">⚙</button>
  </header>
  <main class="editor-page">
    <input type="text" id="post-title" placeholder="タイトルを入力" value="ひみつの記事タイトル">
    <div class="toolbar">
      <button type="button" aria-label="画像を挿入"><svg></svg></button>
      <input type="file" accept="image/*" style="display:none">
      <button type="button">下書き保存</button>
    </div>
    <div class="tiptap ProseMirror" contenteditable="true">
      <p>ひみつの本文です。まだ公開していません。</p>
      <figure><img src="https://example.com/a.png"><figcaption>ひみつのキャプション</figcaption></figure>
    </div>
    <div class="ql-container"><div class="ql-editor" contenteditable="true">ひみつの二つめの本文</div></div>
    <form id="articleSearchForm"><input type="search" placeholder="キーワード、#タグなど" style="display:none"></form>
    <div class="category_select_area"><button type="button" class="category_item">稼ぐ</button><a class="category_child">見本の子カテゴリ</a></div>
    <div id="article_setting_menu"><div class="article_setting_item article_category"><button type="button" class="btn_selectCategory">カテゴリを選択</button></div>
      <div class="article_setting_item article_tag_input"><div class="article_tag_inputArea"><span class="tag_chip">見本のタグ<button type="button" class="tag_remove">×</button></span><input type="text" placeholder="タグを追加してください"></div></div></div>
    <div class="modal show" role="dialog"><ul class="category_list"><li><label><input type="radio" name="category" value="1">見本のカテゴリ</label></li></ul><input type="text" placeholder="カテゴリを検索" value="ひみつの検索語"></div>
    <footer><button type="button">投稿する</button><button type="button" aria-label="公開する"></button></footer>
  </main>
</body></html>`;

/** 拡張の診断を、ページで動く 1 つの関数にまとめる */
function bundle(): string {
  const out = buildSync({
    stdin: {
      contents: `import { buildExtraSiteReport } from "./extension/src/lib/diagnose-extra-site"; globalThis.__diagnose = buildExtraSiteReport;`,
      resolveDir: new URL("..", import.meta.url).pathname,
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    write: false,
  });
  return out.outputFiles[0]!.text;
}

describe("追加の対応先の診断 (DOM)", () => {
  let browser: Browser;
  let page: Page;
  let report = "";
  let watched = { events: [] as string[], changed: true, active: "" };

  before(async () => {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
    page = await browser.newPage();
    await page.goto("about:blank");
    await page.setContent(PAGE);
    await page.addScriptTag({ content: bundle() });
    const r = await page.evaluate(() => {
      const events: string[] = [];
      for (const type of ["click", "input", "focus", "focusin", "keydown", "pointerdown", "change", "submit"]) {
        document.addEventListener(type, () => events.push(type), true);
      }
      const html = document.documentElement.outerHTML;
      const value = (document.querySelector("#post-title") as HTMLInputElement).value;
      let report: string;
      try {
        report = (globalThis as unknown as { __diagnose: () => string }).__diagnose();
      } catch (e) {
        report = `ERROR: ${(e as Error).message}`;
      }
      const changed = document.documentElement.outerHTML !== html || (document.querySelector("#post-title") as HTMLInputElement).value !== value;
      return { report, events, changed, active: document.activeElement?.tagName ?? "" };
    });
    report = r.report;
    watched = r;
  });
  after(async () => {
    await browser?.close();
  });

  it("レポートが作れる", () => {
    assert.ok(report.startsWith("# Last One Click 診断レポート(追加の対応先)"), report);
  });

  it("タイトルの入力欄らしいものと、その道筋が出る", () => {
    const section = sectionOf("タイトルの入力欄らしいもの");
    assert.match(section, /\(1 件\)/);
    assert.match(section, /input #post-title \[type="text" placeholder="タイトルを入力"\]/);
    assert.match(section, /path: #post-title/);
  });

  it("本文の欄とエディタの種類の手がかりが出る", () => {
    assert.match(sectionOf("書ける欄"), /div \.tiptap\.ProseMirror \[contenteditable="true"\]/);
    const hints = sectionOf("エディタの種類の手がかり");
    assert.match(hints, /- ProseMirror: 1 件/);
    assert.match(hints, /- tiptap: 1 件/);
    // 書ける欄を包む外枠も、文字は長さだけ
    assert.match(hints, /- ql-container: 1 件\n  - div \.ql-container \(文字 10 字は出しません\)/);
  });

  it("仮のセレクタのマッチ数が出る", () => {
    const section = sectionOf("仮のセレクタのマッチ数");
    assert.match(section, /- title: 1 件  `input\[placeholder\*="タイトル"\]`/);
    assert.match(section, /- body: 2 件  `\[contenteditable="true"\]`/);
  });

  it("画像のボタンと file input の道筋が出る", () => {
    assert.match(sectionOf("画像を入れるためのボタンらしいもの"), /button \[type="button" aria-label="画像を挿入"\].*path: main\.editor-page > div\.toolbar:nth-of-type\(1\) > button:nth-of-type\(1\)/);
    assert.match(sectionOf("file input"), /input \[type="file" accept="image\/\*"\] \(hidden\) path: main\.editor-page > div\.toolbar:nth-of-type\(1\) > input/);
  });

  it("タグの欄・カテゴリの欄の中と、開いているダイアログの中を出す。ダイアログの選択肢の文字は出し、打つ欄の文字は出さない", () => {
    assert.match(report, /## タグの欄の中[^\n]*\n- div \.article_setting_item\.article_tag_input/);
    assert.match(report, /span \.tag_chip "見本のタグ×"/);
    assert.match(report, /## カテゴリの欄の中[^\n]*\n- div \.article_setting_item\.article_category/);
    assert.match(report, /## 開いているダイアログ・選ぶ画面らしいものの中/);
    // ダイアログの形でない選ぶ画面(class にカテゴリらしい名前)も出す
    assert.match(report, /a \.category_child "見本の子カテゴリ"/);
    // ページ上部の隠れた検索欄ではなく、見えているタグの欄を出す
    assert.doesNotMatch(report, /## タグの欄の中[^\n]*\n- form/);
    assert.match(report, /label "見本のカテゴリ"/);
    assert.doesNotMatch(report, /ひみつの検索語/);
  });

  it("アカウントの表示らしい所の作りを出す。名前・ID・画像の URL は出さない", () => {
    assert.match(report, /## アカウントの表示らしい所の中/);
    assert.match(report, /button \.user-menu .*\(文字 \d+ 字は出しません\)/);
    assert.match(report, /img .*\[画像: src https\]/);
    assert.doesNotMatch(report, /me\.png/);
  });

  it("ボタンの一覧に、文字と道筋が出る", () => {
    assert.match(sectionOf("ボタン(公開・投稿のボタンを除く)"), /"下書き保存" \(visible\) path: main\.editor-page > div\.toolbar:nth-of-type\(1\) > button:nth-of-type\(2\)/);
  });

  it("公開・投稿のボタンは、あることだけを出す", () => {
    assert.match(sectionOf("公開・投稿のボタン"), /あります\(2 件。文字と道筋は出しません\)/);
    assert.doesNotMatch(report, /投稿する/);
    assert.doesNotMatch(report, /公開する/);
    assert.doesNotMatch(report, /footer/);
  });

  it("記事のタイトル・本文・キャプション・アカウントの名前や ID を出さない", () => {
    assert.doesNotMatch(report, /ひみつ/);
    assert.doesNotMatch(report, /9876543/);
    assert.match(report, /data: data-user-id/); // data-* は名前だけ
    // アカウントの表示らしい要素の aria-label・title は長さだけ
    assert.match(report, /aria-label=\(11 字\) title=\(6 字\)/);
  });

  it("ほかの要素の aria-label に入った同じ名前も伏せる", () => {
    assert.match(report, /aria-label="\*\*\*の設定"/);
  });

  it("読むだけ: 押さない・入力しない・フォーカスを動かさない・ページを変えない", () => {
    assert.deepEqual(watched.events, []);
    assert.equal(watched.changed, false);
    assert.equal(watched.active, "BODY");
  });

  function sectionOf(name: string): string {
    const start = report.indexOf(`## ${name}`);
    assert.ok(start >= 0, `「${name}」の節がありません\n${report}`);
    const end = report.indexOf("\n## ", start + 1);
    return report.slice(start, end < 0 ? undefined : end);
  }
});
