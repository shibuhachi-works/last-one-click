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

// ログイン中のアカウントの手がかり: 名前・ID・アイコンの URL は出さず、どこにあるかだけを出す
const NAME = "やまだ花子テスト";
const ID = "hanako_yamada_t";
const ICON = "https://assets.st-note.com/production/uploads/images/987654/profile_zz9secret.png";
const ACCOUNT_PAGE = `<!doctype html><html><head><title>${NAME}｜note</title>
  <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { currentUser: { urlname: ID, nickname: NAME, profileImagePath: ICON }, byName: { [ID]: { id: 1234567 } }, users: { private_handle_zq: { userId: 123456 } } } },
  })}</script>
  <script>window.__NUXT__ = { state: { auth: { user: { urlname: "${ID}", nickname: "${NAME}" } } } };</script>
</head><body>
  <header>
    <a href="https://note.com/${ID}" class="o-navbar__avatar"><img src="${ICON}" alt="${NAME}" class="a-icon" width="32" height="32"></a>
    <button type="button" aria-label="アカウントメニューを開く" aria-haspopup="menu"><img src="${ICON}" alt="${NAME}のアイコン" class="m-avatar"></button>
    <button type="button">${NAME}</button>
    <a href="https://note.com/${ID}/n/n0123abcd">記事</a>
    <a href="/hashtag/note">タグ</a>
  </header>
  <main><textarea placeholder="記事タイトル">タイトル</textarea></main>
</body></html>`;

describe("診断の結果: ログイン中のアカウントの手がかり (DOM)", () => {
  let browser: Browser;
  let report = "";

  before(async () => {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
    const page = await browser.newPage();
    await page.setContent(ACCOUNT_PAGE);
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

  it("名前・ID・アイコンの URL を、レポートのどこにも出さない", () => {
    assert.doesNotMatch(report, /^ERROR/);
    for (const s of [NAME, "やまだ", ID, ICON, "zz9secret", "987654", "1234567"]) assert.ok(!report.includes(s), `${s} が出ています\n${report}`);
  });

  it("アイコンらしい画像は、大きさ・alt の文字数・src のホスト名と道筋を出す", () => {
    assert.match(report, /## ログイン中のアカウントの手がかり/);
    assert.match(report, /### アイコンらしい画像 \(2 件\)/);
    assert.match(report, new RegExp(`- \\d+x\\d+ alt ${NAME.length} 字 src: assets\\.st-note\\.com [^\\n]*path: [^\\n]*img\\.a-icon`));
  });

  it("プロフィールらしいリンクは、ID を文字数だけにして出す(記事・タグのリンクは数えない)", () => {
    assert.match(report, /### プロフィールらしいリンク \(1 件、ID の種類 1 個\)/);
    assert.match(report, new RegExp(`- href: note\\.com/\\*\\*\\*\\(${ID.length} 文字\\) 画像あり [^\\n]*path: [^\\n]*a\\.o-navbar__avatar`));
  });

  it("埋め込まれたデータは、キーの道筋だけを出す(ID をキーにした所は伏せる)", () => {
    assert.match(report, /script#__NEXT_DATA__\[type="application\/json"\]: キー 5 個/);
    assert.match(report, /\.props\.pageProps\.currentUser \(オブジェクト\)/);
    assert.match(report, new RegExp(`\\.props\\.pageProps\\.currentUser\\.nickname \\(文字 ${NAME.length} 字\\)`));
    assert.match(report, /\.props\.pageProps\.currentUser\.profileImagePath \(文字 \d+ 字\)/);
    assert.doesNotMatch(report, /byName\.hanako/);
    // ID をキーにした表は、その ID がデータの値に無くても伏せる
    assert.ok(!report.includes("private_handle_zq"), report);
    assert.match(report, /\.props\.pageProps\.users\.\*\*\*\.userId \(number\)/);
    assert.match(report, /window\.__NUXT__: キー 3 個/);
    assert.match(report, /\.state\.auth\.user\.urlname \(文字 \d+ 字\)/);
    assert.match(report, /__NUXT__ を作る script: 1 個/);
    assert.match(report, /キー: [^\n]*nickname:1/);
  });

  it("メニューを開くボタンは、言葉と道筋を出す", () => {
    assert.match(report, /### メニューを開くボタン \(1 件\)/);
    assert.match(report, /- button 言葉: アカウント・メニュー aria-haspopup="menu" [^\n]*path: /);
  });
});
