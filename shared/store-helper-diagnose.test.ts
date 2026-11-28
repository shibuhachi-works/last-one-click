// 申請用ツールの診断(store-helper/diagnose.mjs。#215)を、ダッシュボードを模した DOM で確かめる。
// 読むだけであること、欄の中の文字とメールアドレスを出さないこと、shadow DOM の中も見ることを見る
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
// @ts-expect-error 型の無い .mjs
import { diagnoseDashboard } from "../store-helper/diagnose.mjs";

const HTML = `<!doctype html><meta charset="utf-8">
<h1>ストアの掲載情報</h1>
<button aria-label="アカウント: someone@example.com">A</button>
<fieldset><legend>説明</legend><textarea maxlength="16000">秘密の説明文</textarea></fieldset>
<label for="cat">カテゴリ</label><select id="cat"><option>仕事効率化</option></select>
<input type="file" accept="image/png" multiple aria-label="スクリーンショット">
<input type="checkbox" aria-label="承認された用途以外で販売しない" checked>
<div role="radio" aria-checked="false" aria-label="いいえ、リモートコードは使用していません"></div>
<button onclick="window.clicked = true">保存</button>
<x-panel id="host"></x-panel>
<script>document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = '<input name="single" value="中身">';</script>`;

describe("store-helper の診断", () => {
  let browser: Browser;
  let page: Page;
  let report: string;
  before(async () => {
    // chrome.google.com/webstore は Chromium が特別に扱って開けないので、別のホストで同じ形の URL を開く
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
    page = await browser.newPage();
    await page.route("https://dashboard.example/**", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: HTML }).catch(() => {}));
    await page.goto("https://dashboard.example/webstore/devconsole/0123456789abcdef0123456789/jomapffkhcdpnodaffobmpfofnnaihnd/edit");
    report = await page.evaluate(`(${diagnoseDashboard.toString()})()`);
  });
  after(async () => {
    await browser?.close();
  });

  it("見出し・入力欄・role の欄・ボタン・ファイルの欄を出す", () => {
    assert.match(report, /h1: ストアの掲載情報/);
    assert.match(report, /「説明」 type=textarea maxlength=16000 value=6 字/);
    assert.match(report, /「カテゴリ」 type=select value=5 字/);
    assert.match(report, /「スクリーンショット」 type=file accept=image\/png multiple/);
    assert.match(report, /「承認された用途以外で販売しない」 type=checkbox checked/);
    assert.match(report, /role=radio 「いいえ、リモートコードは使用していません」 aria-checked=false/);
    assert.match(report, /「保存」/);
  });

  it("shadow DOM の中の欄も出す", () => {
    assert.match(report, /name=single/);
    assert.match(report, /x-panel#host > input/);
  });

  it("欄の中の文字・メールアドレス・長い ID を出さない", () => {
    assert.doesNotMatch(report, /秘密の説明文|中身/);
    assert.doesNotMatch(report, /someone@example\.com/);
    assert.match(report, /<メール>/);
    assert.doesNotMatch(report, /0123456789abcdef0123456789|jomapffkhcdpnodaffobmpfofnnaihnd/);
    assert.match(report, /devconsole\/<id>\/<id>\/edit/);
  });

  it("何も押さない", async () => {
    assert.equal(await page.evaluate("window.clicked"), undefined);
    for (const f of ["diagnose.mjs", "popup.mjs"]) {
      const src = readFileSync(new URL(`../store-helper/${f}`, import.meta.url), "utf8");
      assert.doesNotMatch(src, /\.click\(|dispatchEvent|\.submit\(/, f);
    }
    // ページの欄に書き込まない(ポップアップは自分の欄に結果を出すので、diagnose.mjs だけを見る)
    const diag = readFileSync(new URL("../store-helper/diagnose.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(diag, /\.(value|textContent|innerHTML|innerText)\s*=(?!=)|setAttribute\(/);
  });
});
