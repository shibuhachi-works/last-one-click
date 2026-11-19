// 「有料エリア設定」を押した先の画面を模した DOM で、印の直前の段落のすぐ下の「ラインをこの場所に変更」を押せること、
// 見つからない・2 つ以上あるときは押さないこと、公開のボタン(「投稿する」)と「キャンセル」は押さないことを確かめる。
//
// 画面の作りは 2026-11-16 の診断レポートと、実機のスクリーンショットからの仮定:
//   - 本文は div.ProseMirror.paywall-setting(編集できない)。その直下に、本文のブロック(p・h2・ul・figure など)と
//     div.ProseMirror-widget が交互に並ぶ(診断レポートは本文の文字を出さないので、widget の前の兄弟が本文のブロックかは仮定)
//   - widget の中は button[aria-pressed="false"]「ラインをこの場所に変更」。いまのラインの所だけ
//     button#paywall-line[aria-pressed="true"]「このラインより先を有料にする」になる
//   - 右上のボタンは「キャンセル」と「投稿する」
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { collectClickLabels } from "./click-labels.js";
import { isForbiddenClickText } from "./forbidden-click.js";
import { findPaywallTarget, type PaywallTarget } from "./paywall.js";
import { DEFAULT_PAID, DEFAULT_PAYWALL } from "./selectors-schema.js";

const PAGE = `<!doctype html><html><body>
  <header>
    <button id="cancel" type="button" data-name="Button">キャンセル</button>
    <button id="publish" type="button" data-name="Button">投稿する</button>
  </header>
  <div class="mx-auto mt-0"><div class="p4">
    <div class="ProseMirror paywall-setting" translate="no">
      <h2>最初の見出し</h2>
      <div class="ProseMirror-widget"></div>
      <p>無料の段落です。</p>
      <div class="ProseMirror-widget"></div>
      <figure><img src="data:," alt=""><figcaption></figcaption></figure>
      <div class="ProseMirror-widget"></div>
      <ul><li>いち</li><li>に</li></ul>
      <div class="ProseMirror-widget"></div>
      <p>同じ文字の段落</p>
      <div class="ProseMirror-widget"></div>
      <p>同じ文字の段落</p>
      <div class="ProseMirror-widget"></div>
      <p>有料の段落です。</p>
    </div>
  </div></div>
  <script>
    window.clicked = [];
    document.getElementById("publish").addEventListener("click", () => window.clicked.push("publish"));
    document.getElementById("cancel").addEventListener("click", () => window.clicked.push("cancel"));
    // ラインを index 番目の widget に置き、ほかの widget には「ラインをこの場所に変更」を置く(React の描き直しと同じく、要素ごと入れ替える)
    window.placeLine = (index) => {
      document.querySelectorAll(".ProseMirror-widget").forEach((w, i) => {
        const b = document.createElement("button");
        if (i === index) {
          b.id = "paywall-line";
          b.className = "paywall-line";
          b.setAttribute("aria-pressed", "true");
          b.textContent = "このラインより先を有料にする";
        } else {
          b.setAttribute("aria-pressed", "false");
          b.textContent = "ラインをこの場所に変更";
          b.addEventListener("click", () => { window.clicked.push("line:" + i); window.placeLine(i); });
        }
        w.replaceChildren(b);
      });
    };
    window.placeLine(0); // はじめは最初の見出しのすぐ下
  </script>
</body></html>`;

describe("findPaywallTarget (DOM)", () => {
  let browser: Browser;
  let page: Page;

  before(async () => {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
    page = await browser.newPage();
  });
  after(async () => {
    await browser?.close();
  });
  beforeEach(async () => {
    await page.setContent(PAGE);
  });

  /** ページの中で findPaywallTarget を呼ぶ。見つけたボタンに印を付ける */
  const run = (anchor: string, changeTexts: readonly string[] = DEFAULT_PAYWALL.paywallChangeButtonText) =>
    page.evaluate(
      ([fn, container, widget, texts, line, anchor]) => {
        const f = new Function(`return (${fn})`)() as typeof findPaywallTarget;
        const r = f(container, widget, texts, line, anchor);
        document.querySelectorAll("[data-target]").forEach((e) => e.removeAttribute("data-target"));
        r.button?.setAttribute("data-target", "1");
        return { status: r.status, count: r.count, text: r.button?.textContent ?? null } as Pick<PaywallTarget, "status" | "count"> & { text: string | null };
      },
      [findPaywallTarget.toString(), DEFAULT_PAYWALL.paywallContainer, DEFAULT_PAYWALL.paywallWidget, changeTexts, DEFAULT_PAYWALL.paywallLine, anchor] as const,
    );

  /** 見つけたボタンを押す(拡張の safeClick と同じく、押す前に禁止の文字に当たらないか確かめる) */
  const clickFound = async () => {
    const el = page.locator("[data-target]");
    const labels = await el.evaluate(collectClickLabels);
    assert.ok(!labels.some(isForbiddenClickText), `禁止の文字に当たる: ${labels.join(", ")}`);
    await el.click();
  };
  const clicked = () => page.evaluate(() => (window as unknown as { clicked: string[] }).clicked);

  it("印の直前の段落のすぐ下の「ラインをこの場所に変更」を押すと、ラインがそこへ動き、already になる", async () => {
    const r = await run("無料の段落です。");
    assert.deepEqual(r, { status: "ok", count: 1, text: "ラインをこの場所に変更" });
    await clickFound();
    assert.deepEqual(await clicked(), ["line:1"]);
    assert.equal((await run("無料の段落です。")).status, "already");
    // ラインは目的の段落のすぐ下にある
    const prev = await page.evaluate(() => document.getElementById("paywall-line")!.parentElement!.previousElementSibling!.textContent);
    assert.equal(prev, "無料の段落です。");
  });

  it("何番目かではなく文字で探す: 箇条書きのすぐ下を選ぶ。空白の違いは無視する", async () => {
    const r = await run("いち\nに");
    assert.equal(r.status, "ok");
    await clickFound();
    assert.deepEqual(await clicked(), ["line:3"]);
    assert.equal((await run(" いち に ")).status, "already");
  });

  it("ラインがもう目的の場所にあれば押さない(already)", async () => {
    assert.deepEqual(await run("最初の見出し"), { status: "already", count: 1, text: null });
    assert.deepEqual(await clicked(), []);
  });

  it("一致するブロックが無い・2 つ以上・文字が空のときは、ボタンを返さない(押さない)", async () => {
    assert.deepEqual(await run("どこにも無い段落"), { status: "not-found", count: 0, text: null });
    assert.deepEqual(await run("同じ文字の段落"), { status: "many", count: 2, text: null });
    assert.deepEqual(await run("  "), { status: "no-anchor", count: 0, text: null });
    // 最後の段落のすぐ下には widget が無い
    assert.deepEqual(await run("有料の段落です。"), { status: "no-button", count: 1, text: null });
    assert.equal(await page.locator("[data-target]").count(), 0);
    assert.deepEqual(await clicked(), []);
  });

  it("有料エリア設定の画面でなければ no-screen", async () => {
    await page.evaluate(() => document.querySelector(".paywall-setting")!.classList.remove("paywall-setting"));
    assert.equal((await run("無料の段落です。")).status, "no-screen");
  });

  it("selectors のボタンの文字が別の部品(「投稿する」など)を指していても、widget の外のボタンは返さず、公開のボタンは押さない", async () => {
    const r = await run("無料の段落です。", ["投稿する", "キャンセル"]);
    assert.equal(r.status, "no-button");
    assert.deepEqual(await clicked(), []);
    // 押すボタン・「有料エリア設定」は禁止の文字に当たらず、この画面の「投稿する」は禁止のまま
    assert.equal(isForbiddenClickText(DEFAULT_PAYWALL.paywallChangeButtonText[0]), false);
    assert.equal(isForbiddenClickText(DEFAULT_PAID.paidAreaButtonText[0]), false);
    assert.equal(isForbiddenClickText(await page.locator("#publish").textContent()), true);
  });
});
