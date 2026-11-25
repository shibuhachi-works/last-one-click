// 追加の対応先のページに出ているログイン中のアカウントを読む(extension/src/lib/extra-site-account.ts)を、ブラウザで確かめる。
// ヘッダーのアイコンを読むこと、名前のセレクタが当たれば名前も読むこと、https でない画像や長すぎる文字は使わないこと
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildSync } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

function bundle(): string {
  const out = buildSync({
    stdin: {
      contents: `import { readExtraSiteAccount } from "./extension/src/lib/extra-site-account";
        Object.assign(globalThis, { __read: readExtraSiteAccount });`,
      resolveDir: new URL("..", import.meta.url).pathname,
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    write: false,
  });
  return out.outputFiles[0]!.text;
}

const HEADER = `<header><nav><div class="header_nav">
  <button class="menu_btn btn_mypage" type="button"><img class="rounded-circle" src="https://example.com/icon.png" alt="">メニュー</button>
</div></nav></header>`;

describe("追加の対応先のアカウントを読む (DOM)", () => {
  let browser: Browser;
  let page: Page;
  const src = bundle();

  before(async () => {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
    page = await browser.newPage();
  });
  after(async () => {
    await browser?.close();
  });

  async function read(html: string, selectors?: { accountIcon: string[]; accountName: string[] }) {
    await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
    await page.addScriptTag({ content: src });
    return page.evaluate((s) => (globalThis as any).__read(document, s ?? undefined), selectors ?? null);
  }

  it("既定のセレクタでは、ヘッダーのアイコンだけを読む(名前のセレクタはまだ無い)", async () => {
    assert.deepEqual(await read(HEADER), { iconUrl: "https://example.com/icon.png" });
  });

  it("名前のセレクタが当たれば、名前も読む(空白はまとめる)", async () => {
    const html = `${HEADER}<aside><p class="side_name">  しぶ\n  はち </p></aside>`;
    assert.deepEqual(await read(html, { accountIcon: [".btn_mypage img.rounded-circle"], accountName: [".side_name"] }), {
      name: "しぶ はち",
      iconUrl: "https://example.com/icon.png",
    });
  });

  it("https でない画像・長すぎる名前は使わない。何も無ければ null", async () => {
    const html = `<button class="btn_mypage"><img class="rounded-circle" src="http://example.com/a.png"></button><p class="n">${"あ".repeat(61)}</p>`;
    assert.equal(await read(html, { accountIcon: [".btn_mypage img.rounded-circle"], accountName: [".n"] }), null);
    assert.equal(await read("<p>なし</p>"), null);
  });

  it("書き方の違うセレクタは飛ばして、次を見る", async () => {
    assert.deepEqual(await read(HEADER, { accountIcon: ["::bad(", ".btn_mypage img"], accountName: [] }), { iconUrl: "https://example.com/icon.png" });
  });
});
