// 追加の対応先の確かめ(probeEditor)を、拡張と同じように「関数の文字だけ」をページに渡して動かす。
// chrome.scripting.executeScript は関数を文字にして渡すので、外の変数を使っていると動かない。読むだけであることも見る
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildSync } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { EXTRA_SITE_EDITOR_PROBE } from "./extra-site.js";

/** 拡張のビルドと同じく esbuild でまとめ、probeEditor の関数の文字を取り出す */
function probeSource(): string {
  const out = buildSync({
    stdin: {
      contents: `import { probeEditor } from "./shared/extra-site"; globalThis.__src = probeEditor.toString();`,
      resolveDir: new URL("..", import.meta.url).pathname,
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    target: "chrome120",
    write: false,
  });
  const scope: { __src?: string } = {};
  new Function("globalThis", out.outputFiles[0]!.text)(scope);
  assert.ok(scope.__src, "probeEditor の文字を取り出せませんでした");
  return scope.__src;
}

const EDITOR = `<!doctype html><html><body>
  <input type="text" placeholder="タイトルを入力">
  <div contenteditable="true"><p>本文</p></div>
  <button type="button">投稿する</button>
</body></html>`;

describe("probeEditor (DOM)", () => {
  let browser: Browser;
  let page: Page;
  let src = "";

  before(async () => {
    src = probeSource();
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
    page = await browser.newPage();
  });
  after(async () => {
    await browser?.close();
  });

  /** 関数の文字だけをページに渡して動かす(executeScript と同じ)。ページの変化とイベントも記録する */
  async function run(html: string, probe = EXTRA_SITE_EDITOR_PROBE) {
    await page.setContent(html);
    return page.evaluate(
      ({ src, probe }) => {
        const events: string[] = [];
        for (const type of ["click", "input", "focus", "keydown", "pointerdown"]) {
          document.addEventListener(type, () => events.push(type), true);
        }
        const before = document.documentElement.outerHTML;
        const found = (new Function(`return (${src})`)() as (p: unknown) => boolean)(probe);
        return { found, events, changed: document.documentElement.outerHTML !== before, active: document.activeElement?.tagName };
      },
      { src, probe },
    );
  }

  it("タイトルと本文の入力欄があれば true。ページを変えず、イベントも起こさない", async () => {
    const r = await run(EDITOR);
    assert.equal(r.found, true);
    assert.deepEqual(r.events, []);
    assert.equal(r.changed, false);
    assert.equal(r.active, "BODY");
  });

  it("本文の欄が無ければ false", async () => {
    const r = await run(`<!doctype html><html><body><input placeholder="タイトルを入力"></body></html>`);
    assert.equal(r.found, false);
  });

  it("タイトルの欄が無ければ false", async () => {
    const r = await run(`<!doctype html><html><body><div contenteditable="true"></div></body></html>`);
    assert.equal(r.found, false);
  });

  it("記事の一覧など、入力欄の無いページでは false", async () => {
    const r = await run(`<!doctype html><html><body><a href="/a">記事</a><button>投稿する</button></body></html>`);
    assert.equal(r.found, false);
  });

  it("書き方の誤ったセレクタがあっても、止まらずに残りを見る", async () => {
    const r = await run(EDITOR, { title: ["[[bad", ...EXTRA_SITE_EDITOR_PROBE.title], body: EXTRA_SITE_EDITOR_PROBE.body });
    assert.equal(r.found, true);
  });
});
