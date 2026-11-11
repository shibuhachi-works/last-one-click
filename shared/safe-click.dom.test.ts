// 拡張の実装をそのままブラウザで動かし、禁止判定より前のイベントも検出する。
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { build } from "../extension/node_modules/esbuild/lib/main.js";

type SafeClickWindow = Window & {
  safeClickApi: typeof import("../extension/src/lib/safe-click.js");
  events: string[];
};

const PAGE = `<!doctype html><html><body>
  <button id="save">保存</button>
  <button id="next">公開に進む</button>
  <button id="publish">投稿する</button>
  <button id="icon" aria-label="記事を公開する"><span></span></button>
  <button id="parent"><span id="inner">公開する</span></button>
  <input id="submit" type="submit" value="公開">
</body></html>`;
const pressEvents = ["pointerover", "mouseover", "pointermove", "mousemove", "pointerdown", "mousedown"];
const releaseEvents = ["pointerup", "mouseup"];
const operations = ["click", "click-at", "press", "key-enter", "key-space", "key-backspace"] as const;
type Operation = typeof operations[number];

// ブラウザ内でも全操作を実物の safeClick / safePress / safeKey に通す。
async function exercise(page: Page, selector: string, operation: Operation, click = false) {
  return page.evaluate(({ selector, operation, click }) => {
    const w = window as unknown as SafeClickWindow;
    const el = document.querySelector<HTMLElement>(selector)!;
    const at = { x: 20, y: 30 };
    let phase = "start";
    let error: string | null = null;
    let beforeRelease: string[] | null = null;
    try {
      switch (operation) {
        case "click":
          w.safeClickApi.safeClick(el, selector);
          break;
        case "click-at":
          w.safeClickApi.safeClick(el, selector, { at });
          break;
        case "press": {
          const press = w.safeClickApi.safePress(el, selector, at);
          phase = "release";
          beforeRelease = [...w.events];
          press.release({ click });
          break;
        }
        default:
          w.safeClickApi.safeKey(el, selector,
            operation === "key-enter" ? "Enter" : operation === "key-space" ? " " : "Backspace");
      }
      phase = "done";
    } catch (caught) {
      error = caught instanceof Error ? caught.name : String(caught);
    }
    return { phase, error, beforeRelease, events: [...w.events] };
  }, { selector, operation, click });
}

describe("拡張の safeClick / safePress / safeKey (DOM)", () => {
  let browser: Browser;
  let page: Page;
  let bundle: string;

  before(async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL("../extension/src/lib/safe-click.ts", import.meta.url))],
      bundle: true,
      format: "iife",
      globalName: "safeClickApi",
      platform: "browser",
      write: false,
    });
    bundle = result.outputFiles[0].text;
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  beforeEach(async () => {
    await page.setContent(PAGE);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => {
      const w = window as unknown as SafeClickWindow;
      w.events = [];
      for (const el of document.querySelectorAll("button, input")) {
        for (const event of ["click", "pointerover", "pointermove", "pointerdown", "pointerup",
          "mouseover", "mousemove", "mousedown", "mouseup", "keydown", "keyup"]) {
          el.addEventListener(event, () => w.events.push(event));
        }
      }
    });
  });
  after(async () => { await browser?.close(); });

  for (const selector of ["#publish", "#icon", "#parent", "#inner", "#submit"]) {
    for (const operation of operations) {
      it(`${selector}: ${operation} はイベントを一切起こさず、release より前に止まる`, async () => {
        const result = await exercise(page, selector, operation, true);
        assert.equal(result.error, "ForbiddenClickError");
        assert.equal(result.phase, "start");
        assert.equal(result.beforeRelease, null);
        assert.deepEqual(result.events, []);
      });
    }
  }

  for (const selector of ["#save", "#next"]) {
    for (const operation of operations.filter((operation) => operation !== "press")) {
      it(`${selector}: ${operation} は許可されたイベントを起こす`, async () => {
        const result = await exercise(page, selector, operation);
        assert.equal(result.error, null);
        assert.equal(result.phase, "done");
        assert.deepEqual(result.events, operation.startsWith("key-") ? ["keydown", "keyup"] : ["click"]);
      });
    }
    for (const click of [false, true]) {
      it(`${selector}: safePress → release({ click: ${click} })`, async () => {
        const result = await exercise(page, selector, "press", click);
        assert.equal(result.error, null);
        assert.equal(result.phase, "done");
        assert.deepEqual(result.beforeRelease, pressEvents);
        assert.deepEqual(result.events, [...pressEvents, ...releaseEvents, ...(click ? ["click"] : [])]);
      });
    }
  }
});
