// note の「タイトル、本文を入力してください」のお知らせを探す(findEmptyAlert)を、模した DOM で確かめる(#178)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { findEmptyAlert } from "./empty-alert.js";

describe("findEmptyAlert (DOM)", () => {
  let browser: Browser;
  let page: Page;

  before(async () => {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
    page = await browser.newPage();
  });
  after(async () => {
    await browser?.close();
  });

  const run = (html: string) =>
    page.setContent(html).then(() =>
      page.evaluate((fn) => {
        const f = new Function(`return (${fn})`)() as typeof findEmptyAlert;
        const r = f();
        return { alert: r.alert?.id ?? null, close: r.close?.id ?? null };
      }, findEmptyAlert.toString()),
    );

  it("お知らせと、それを含むいちばん内側の箱の「閉じる」を返す(エディタの上の別の「閉じる」は返さない)", async () => {
    const r = await run(`<!doctype html><body>
      <header><button id="other-close" type="button">閉じる</button></header>
      <div role="alertdialog"><div><p id="msg">タイトル、本文を入力してください</p></div><button id="close" type="button">閉じる</button></div>
      <button type="button">公開に進む</button>
    </body>`);
    assert.deepEqual(r, { alert: "msg", close: "close" });
  });

  it("記事の本文・タイトルの中の同じ文は、お知らせとみなさない", async () => {
    const r = await run(`<!doctype html><body>
      <textarea id="title">タイトル、本文を入力してください</textarea>
      <div contenteditable="true"><p id="body-line">タイトル、本文を入力してください</p></div>
    </body>`);
    assert.deepEqual(r, { alert: null, close: null });
  });

  it("見えていないお知らせは返さない。閉じるボタンが無ければ close は null", async () => {
    assert.deepEqual(await run(`<!doctype html><body><div hidden><p id="msg">タイトル、本文を入力してください</p></div></body>`), { alert: null, close: null });
    assert.deepEqual(await run(`<!doctype html><body><div><span id="msg">タイトルと本文を入力してください</span></div></body>`), { alert: "msg", close: null });
  });
});
