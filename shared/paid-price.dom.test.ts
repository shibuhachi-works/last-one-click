// 公開設定の画面(2026-11-16 の診断レポート: 記事タイプの隠れたラジオ input#free / input#paid と、文字が「無料」「有料」の label。
// 「有料」を選ぶと価格の欄 input#price が出て、右上のボタンが「有料エリア設定」になる)を模した DOM で、
// 「有料」の label を見つけ、押すと価格の欄が出て値が入ること、ほかの部品(「無料」・「有料エリア設定」)を返さないことを確かめる。
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { collectClickLabels } from "./click-labels.js";
import { isForbiddenClickText } from "./forbidden-click.js";
import { findPaidControls } from "./paid-price.js";
import { DEFAULT_PAID } from "./selectors-schema.js";

const PAGE = `<!doctype html><html><body>
  <header><button id="top" type="button" data-name="Button">投稿する</button></header>
  <nav><button id="item-paid-setting" type="button">記事タイプ</button></nav>
  <section>
    <h3>記事タイプ</h3>
    <div><input type="radio" name="is_paid" id="free" value="free" checked hidden><label for="free">無料</label></div>
    <div><input type="radio" name="is_paid" id="paid" value="paid" hidden><label for="paid">有料</label></div>
    <div id="price-box"></div>
    <input type="radio" name="sale_setting" id="sale-off" checked hidden><label for="sale-off">セールしない</label>
  </section>
  <script>
    // React の入力欄と同じく、input イベントで値を覚える(値を入れただけでは覚えない)
    window.state = { price: "" };
    document.querySelectorAll('input[name="is_paid"]').forEach((r) =>
      r.addEventListener("change", () => {
        const box = document.getElementById("price-box");
        const top = document.getElementById("top");
        if (r.id === "paid" && r.checked) {
          if (!document.getElementById("price")) {
            const p = document.createElement("input");
            p.id = "price";
            p.type = "text";
            p.placeholder = "300";
            p.addEventListener("input", () => (window.state.price = p.value));
            box.append(p);
          }
          top.textContent = "有料エリア設定";
        } else {
          box.replaceChildren();
          top.textContent = "投稿する";
        }
      }),
    );
  </script>
</body></html>`;

describe("findPaidControls (DOM)", () => {
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

  /** ページの中で findPaidControls を呼ぶ。見つけた label に印を付け、その id と文字を返す */
  const run = (radio: string = DEFAULT_PAID.paidRadio, texts: readonly string[] = DEFAULT_PAID.paidLabelText) =>
    page.evaluate(
      ([fn, radio, texts, priceSel]) => {
        const f = new Function(`return (${fn})`)() as typeof findPaidControls;
        const r = f(radio, texts, priceSel);
        document.querySelectorAll("[data-paid]").forEach((e) => e.removeAttribute("data-paid"));
        r.label?.setAttribute("data-paid", "1");
        return { label: r.label?.getAttribute("for") ?? null, text: r.label?.textContent ?? null, checked: r.checked, price: r.priceInput?.id ?? null };
      },
      [findPaidControls.toString(), radio, texts, DEFAULT_PAID.priceInput] as const,
    );

  /** 見つけた label を押す(拡張の safeClick と同じく、押す前に禁止の文字に当たらないか確かめる) */
  const clickFound = async () => {
    const el = page.locator("[data-paid]");
    const labels = await el.evaluate(collectClickLabels);
    assert.ok(!labels.some(isForbiddenClickText), `禁止の文字に当たる: ${labels.join(", ")}`);
    await el.click();
  };

  it("選ぶ前: 「有料」の label を返し、価格の欄はまだ無い", async () => {
    assert.deepEqual(await run(), { label: "paid", text: "有料", checked: false, price: null });
  });

  it("「有料」を押すと価格の欄が出て、input イベントの届く入れ方で値が入る。右上のボタン(有料エリア設定)は押さない", async () => {
    await run();
    await clickFound();
    assert.deepEqual(await run(), { label: "paid", text: "有料", checked: true, price: "price" });
    // 拡張の content.ts の setNativeValue と同じ入れ方(React の入力欄は、value を書き換えただけでは値を覚えない)
    const state = await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>("input#price")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, "300");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return (window as unknown as { state: { price: string } }).state.price;
    });
    assert.equal(state, "300");
    assert.equal(await page.locator("#top").textContent(), "有料エリア設定");
  });

  it("selectors が「無料」のラジオを指していても、文字が「有料」でない label は返さない", async () => {
    const r = await run("input#free", ["有料"]);
    assert.equal(r.label, null);
  });

  it("ラジオが見つからなくても、文字が「有料」の label で見つける。「有料」の label が無ければ何も返さない", async () => {
    await page.evaluate(() => {
      document.getElementById("paid")!.removeAttribute("id");
      document.querySelector('label[for="paid"]')!.setAttribute("for", "x");
    });
    const r = await run();
    assert.equal(r.text, "有料");
    await page.evaluate(() => document.querySelectorAll("label").forEach((l) => l.textContent === "有料" && l.remove()));
    assert.equal((await run()).label, null);
    assert.equal((await run()).text, null);
  });
});
