// 診断の結果(拡張の「DOM 情報を取得」)に、記事のタイトルや本文の文字が入らないことを確かめる。
// 診断の結果は、公開の Issue に貼ってもらうことがある(.github/ISSUE_TEMPLATE/bug_report.yml)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { buildSync } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

const PAGE = `<!doctype html><html><head><title>ひみつの記事タイトル｜note</title></head><body>
  <header><button type="button">公開に進む</button><button type="button" aria-label="メニュー"></button></header>
  <main>
    <textarea placeholder="記事タイトル">ひみつの記事タイトル</textarea>
    <div class="ProseMirror" contenteditable="true">
      <h2>ひみつの見出し</h2>
      <p>ひみつの本文です。まだ公開していません。</p>
      <figure><img src="https://example.com/a.png"><figcaption>ひみつのキャプション</figcaption><button type="button">ひみつのボタン</button></figure>
    </div>
  </main>
</body></html>`;

/** 拡張の診断(extension/src/lib/diagnose.ts)を、ページで動く 1 つの関数にまとめる */
function bundle(): string {
  const out = buildSync({
    stdin: {
      contents: `import { buildDiagnosticReport } from "./extension/src/lib/diagnose"; globalThis.__diagnose = buildDiagnosticReport;`,
      resolveDir: new URL("..", import.meta.url).pathname,
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    write: false,
  });
  return out.outputFiles[0]!.text;
}

/** 本物の画面の定義(診断はこれに合う要素の数も出す) */
const SELECTORS = JSON.parse(readFileSync(new URL("../selectors/note.json", import.meta.url), "utf8"));

describe("診断の結果 (DOM)", () => {
  let browser: Browser;
  let page: Page;
  let report = "";

  before(async () => {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
    page = await browser.newPage();
    await page.setContent(PAGE);
    await page.addScriptTag({ content: bundle() });
    report = await page.evaluate((S) => {
      try {
        return (globalThis as unknown as { __diagnose: (s: unknown) => string }).__diagnose(S);
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    }, SELECTORS);
  });
  after(async () => {
    await browser?.close();
  });

  it("記事のタイトル・本文・見出し・キャプションの文字を出さない", () => {
    assert.doesNotMatch(report, /^ERROR/);
    assert.doesNotMatch(report, /ひみつ/, report);
  });

  it("書ける欄は、文字の長さだけを出す", () => {
    assert.match(report, /contenteditable="true"[^\n]*\(文字 \d+ 字は出しません\)/);
  });

  it("本文の外のボタンの文字は、これまでどおり出す(セレクタを直すのに使う)", () => {
    assert.match(report, /"公開に進む"/);
  });
});
