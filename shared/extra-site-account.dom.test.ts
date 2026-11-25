// 追加の対応先のページに出ているログイン中のアカウントを読む(extension/src/lib/extra-site-account.ts)を、ブラウザで確かめる。
// ヘッダーのアイコンを読むこと、名前のセレクタが当たれば名前も読むこと、https でない画像や長すぎる文字は使わないこと
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildSync } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

function bundle(): string {
  const out = buildSync({
    stdin: {
      contents: `import { readExtraSiteAccount, loadExtraSiteAccount } from "./extension/src/lib/extra-site-account";
        Object.assign(globalThis, { __read: readExtraSiteAccount, __load: loadExtraSiteAccount });`,
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

/** マイページの左の欄(実機の作り: #sidebar > section.mypageSide > div.profile の中の画像と p.profile_name) */
const SIDE = `<div id="sidebar"><section class="mypageSide"><div class="profile text-center">
  <div class="profile_img mx-auto"><img class="rounded-circle" src="https://example.com/side.png" alt=""></div>
  <p class="profile_name fw-bold"> 見本の書き手 </p>
</div></section></div>`;

describe("追加の対応先のアカウントを読む (DOM)", () => {
  let browser: Browser;
  let page: Page;
  let page_: Page;
  const src = bundle();

  before(async () => {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
    page = await browser.newPage();
    page_ = page;
  });
  after(async () => {
    await browser?.close();
  });

  async function read(html: string, selectors?: { accountIcon: string[]; accountName: string[] }) {
    await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
    await page.addScriptTag({ content: src });
    return page.evaluate((s) => (globalThis as any).__read(document, s ?? undefined), selectors ?? null);
  }

  it("既定のセレクタでは、ヘッダーのアイコンと、マイページの左の欄の名前を読む", async () => {
    assert.deepEqual(await read(HEADER), { iconUrl: "https://example.com/icon.png" });
    assert.deepEqual(await read(HEADER + SIDE), { name: "見本の書き手", iconUrl: "https://example.com/icon.png" });
  });

  /** 今のページを html にして、マイページを読む関数を差し替えて loadExtraSiteAccount を動かす */
  async function load(html: string, page: { html: string; url: string } | null) {
    await page_.setContent(`<!doctype html><html><body>${html}</body></html>`);
    await page_.addScriptTag({ content: src });
    // tsx が関数に足す名前の補助(__name)がページに無いので、ページの中の関数は文字で渡す
    await page_.addScriptTag({
      content: `globalThis.__runLoad = async (p) => { const calls = []; const account = await globalThis.__load({ fetchPage: async (url) => { calls.push(url); return p; } }); return { account, calls }; };`,
    });
    return page_.evaluate((p) => (globalThis as any).__runLoad(p), page);
  }

  it("今のページに名前があれば、マイページは読まない", async () => {
    const r = await load(HEADER + SIDE, { html: "", url: "https://library.libecity.com/notification_settings" });
    assert.deepEqual(r.account, { name: "見本の書き手", iconUrl: "https://example.com/icon.png" });
    assert.deepEqual(r.calls, []);
  });

  it("今のページに名前が無ければ(編集画面など)、マイページを 1 回だけ読んで名前を足す。アイコンは今のページのもの", async () => {
    const r = await load(HEADER, { html: `<!doctype html><html><body>${SIDE.replace("https://example.com/side.png", "/side.png")}</body></html>`, url: "https://library.libecity.com/notification_settings" });
    assert.deepEqual(r.account, { name: "見本の書き手", iconUrl: "https://example.com/icon.png" });
    assert.deepEqual(r.calls, ["https://library.libecity.com/notification_settings"]);
  });

  it("マイページの画像の相対の URL は、マイページの URL を元にする", async () => {
    const r = await load("<p>アイコンなし</p>", { html: `<!doctype html><html><body>${SIDE.replace("https://example.com/side.png", "/side.png")}</body></html>`, url: "https://library.libecity.com/notification_settings" });
    assert.deepEqual(r.account, { name: "見本の書き手", iconUrl: "https://library.libecity.com/side.png" });
  });

  it("ログインの画面など別のサイトに移った・読めなかったときは、今のページで読めたものだけを返す", async () => {
    const away = await load(HEADER, { html: `<!doctype html><html><body>${SIDE}</body></html>`, url: "https://login.example.com/" });
    assert.deepEqual(away.account, { iconUrl: "https://example.com/icon.png" });
    const none = await load(HEADER, null);
    assert.deepEqual(none.account, { iconUrl: "https://example.com/icon.png" });
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
