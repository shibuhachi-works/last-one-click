// 追加の対応先のページに出す知らせ(extension/src/lib/extra-site-banner.ts)を、ブラウザで確かめる。
// shadow DOM に閉じること、入れている途中は回る印と操作を控えるお願いを出すこと、文だけを書き換えられること、
// 詳細・たたむ・閉じるが動くこと、中身を HTML として読まないこと
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildSync } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

function bundle(): string {
  const out = buildSync({
    stdin: {
      contents: `import { showBanner, showBannerStatus, BANNER_ID } from "./extension/src/lib/extra-site-banner";
        import { resultMessage } from "./extension/src/lib/extra-site-fill";
        Object.assign(globalThis, { __show: showBanner, __status: showBannerStatus, __id: BANNER_ID, __result: resultMessage });`,
      resolveDir: new URL("..", import.meta.url).pathname,
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    write: false,
  });
  return out.outputFiles[0]!.text;
}

describe("追加の対応先のページの知らせ (DOM)", () => {
  let browser: Browser;
  let page: Page;
  const src = bundle();
  const host = "#last-one-click-extra-site-banner";

  before(async () => {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
    page = await browser.newPage();
  });
  after(async () => {
    await browser?.close();
  });
  beforeEach(async () => {
    await page.goto("about:blank");
    await page.setContent(`<!doctype html><html><body><button id="save">下書き保存</button></body></html>`);
    await page.addScriptTag({ content: src });
  });

  it("入れている途中は、回る印と操作を控えるお願いを出し、文だけを書き換える。たたんだままにできる", async () => {
    await page.evaluate(() => (globalThis as any).__show("下書きを入れています…"));
    const b = page.locator(host);
    assert.equal(await b.locator(".spin").count(), 2);
    assert.match((await b.locator("#wait").textContent()) ?? "", /^処理中です。編集画面は操作せずにお待ちください。$/);
    assert.equal(await b.locator("#chip").textContent(), "入力中");
    assert.equal(await b.locator(".title").textContent(), "Last One Click for library.libecity.com");
    // 見出し・印・「たたむ」が 1 行に収まる(折り返すと行の高さが 2 行分になる)
    assert.ok(((await b.locator(".head").boundingBox())?.height ?? 99) < 32, "見出しの行が折り返しています");
    assert.equal(await b.getByRole("button", { name: "知らせを閉じる" }).count(), 0, "入れている途中に閉じるが出ています");
    // ページの querySelectorAll には当たらない(shadow DOM)
    assert.equal(await page.evaluate(() => document.querySelectorAll("button").length), 1);

    await b.getByRole("button", { name: "知らせをたたむ" }).click();
    await page.evaluate(() => (globalThis as any).__status("タグを入れています…"));
    assert.equal(await b.locator("#pill").isVisible(), true, "文を書き換えたら、たたんだ知らせが開いてしまいました");
    await b.locator("#pill").click();
    assert.equal(await b.locator("#sum").textContent(), "タグを入れています…");
  });

  it("入れ終えたら、色分けした詳細・閉じるを出す。たたんでいたら、たたんだまま結果に変わる", async () => {
    await page.evaluate(() => (globalThis as any).__show("下書きを入れています…"));
    const b = page.locator(host);
    await b.getByRole("button", { name: "知らせをたたむ" }).click();
    await page.evaluate(() => {
      const m = (globalThis as any).__result({ ok: true, lines: ["✓ タイトル", "⚠ 本文の画像: キャプションは入れていません", "✗ タグ: 見つかりません"] });
      (globalThis as any).__show(m.text, m.kind);
    });
    assert.equal(await b.locator("#pill").isVisible(), true);
    assert.match((await b.locator("#pill").textContent()) ?? "", /確かめてください/);
    await b.locator("#pill").click();
    // いちばん長い「確かめてください」と「たたむ」「閉じる」でも、見出しの行は 1 行
    assert.ok(((await b.locator(".head").boundingBox())?.height ?? 99) < 32, "見出しの行が折り返しています");
    assert.equal(await b.locator(".spin").count(), 0, "終わったあとも回る印が出ています");
    assert.equal(await b.locator("#wait").count(), 0);
    assert.match((await b.locator("#sum").textContent()) ?? "", /^✅ 下書きを入れました。\n「下書き保存」か「確認画面へ」を押してください。(\n|$)/);

    assert.equal(await b.locator("#det").isVisible(), false);
    await b.getByRole("button", { name: "詳細" }).click();
    assert.equal(await b.locator("#det").isVisible(), true);
    const colors = await b.locator("#det div").evaluateAll((ds) => ds.map((d) => (d as HTMLElement).style.color));
    assert.equal(new Set(colors).size, 3, "✓・⚠・✗ の行が色分けされていません");

    await b.getByRole("button", { name: "知らせを閉じる" }).click();
    assert.equal(await page.locator(host).count(), 0);
  });

  it("エラーは role=alert で出す。中身は HTML として読まない", async () => {
    await page.evaluate(() => (globalThis as any).__show(`エラー: <img src=x onerror="window.__x=1">`, "error"));
    const b = page.locator(host);
    assert.equal(await b.locator("#box").getAttribute("role"), "alert");
    assert.equal(await b.locator("#chip").textContent(), "エラー");
    assert.equal(await b.locator("img").count(), 0);
    assert.match((await b.locator("#sum").textContent()) ?? "", /<img src=x/);
  });
});
