// ビルドした拡張(extension/dist)を実際の Chromium に読み込み、ポップアップから下書きを作るまでを通しで確かめる。
// 部品ごとのテストでは分からない「拡張として読み込めるか」「依存を上げても md → HTML → note のエディタまで通るか」を見る。
//
// note のエディタは本物の代わりに、同じセレクタに当たる模擬ページを返す(note.com には出ていかない)。
// 先に extension で `npm run build` が要る(CI では build してからこのテストを動かす)。
// ブラウザは playwright の chromium(拡張は headless shell では動かないので、channel: "chromium" を使う)。
// 別の chromium を使う場合は PLAYWRIGHT_CHROMIUM_PATH に実行ファイルのパスを入れる。
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";
import { collectClickLabels } from "./click-labels.js";
import { assertClickAllowed } from "./forbidden-click.js";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../extension/dist");

// note の記事編集ページを模したもの。タイトル欄と本文(ProseMirror)だけを持ち、貼り付けは text/html をそのまま入れる
const EDITOR = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>note</title></head><body>
  <textarea id="title" placeholder="記事タイトル"></textarea>
  <div id="body" class="ProseMirror" contenteditable="true"><p><br></p></div>
  <div id="spacer"></div>
  <button id="open-menu" type="button" aria-label="メニューを開く">+</button>
  <div id="menu" hidden><button id="toc-setting" type="button">目次</button></div>
  <script>
    const body = document.getElementById("body");
    // カーソルのある本文の行(body の直下の要素)
    const caretBlock = () => {
      const sel = getSelection();
      let n = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
      while (n && n.parentNode !== body) n = n.parentNode;
      return n;
    };
    // 貼り付けは、カーソルのある空の行に text/html を入れる(カーソルが無ければ最後に足す)
    body.addEventListener("paste", (e) => {
      e.preventDefault();
      const t = document.createElement("template");
      t.innerHTML = e.clipboardData.getData("text/html");
      const b = caretBlock();
      if (b && b.tagName === "P" && b.textContent.trim() === "") b.replaceWith(t.content);
      else body.append(t.content);
      // 本物のエディタは、長い本文を貼ると画面が本文の最後まで動く
      document.getElementById("spacer").style.height = "5000px";
      window.scrollTo(0, document.body.scrollHeight);
      // 本物のエディタは貼り付けで画面の要素を作り直し、目次は作り(要素の種類など)も変わる(2026-11-10 実機)。
      // 拡張が貼ったあとに目次を要素や特徴で探すと、目次が残っていても「消えた」と誤って出るので、それを再現する
      for (const toc of body.querySelectorAll(".toc")) {
        const nav = document.createElement("nav");
        nav.className = "toc";
        nav.textContent = toc.textContent;
        toc.replaceWith(nav);
      }
    });
    // 本物と同じく、URL だけの行の末尾で Enter を押すと埋め込み(カード)に変わる(2026-11-10 実機)。
    // URL 以外の行での Enter は空の行を足し、空の行での Backspace はその行を消す
    body.addEventListener("keydown", (e) => {
      const b = caretBlock();
      if (!b) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const text = b.textContent.trim();
        if (b.tagName === "P" && /^https?:\\/\\/\\S+$/.test(text)) {
          const card = document.createElement("figure");
          card.className = "embed";
          card.dataset.url = text;
          b.replaceWith(card);
          return;
        }
        const p = document.createElement("p");
        p.innerHTML = "<br>";
        b.after(p);
        getSelection().collapse(p, 0);
      } else if (e.key === "Backspace" && b.tagName === "P" && b.textContent.trim() === "") {
        e.preventDefault();
        b.remove();
      }
    });
    // 本物と同じく「+」→「目次」で、カーソルのある行の次の行に目次が入る(その下に空の行ができる)
    document.getElementById("open-menu").addEventListener("click", () => (document.getElementById("menu").hidden = false));
    document.getElementById("toc-setting").addEventListener("click", () => {
      const toc = document.createElement("div");
      toc.className = "toc";
      toc.textContent = "目次";
      const p = document.createElement("p");
      p.innerHTML = "<br>";
      const b = caretBlock() ?? body.lastElementChild;
      b.after(toc, p);
      document.getElementById("menu").hidden = true;
    });
  </script>
</body></html>`;

const ARTICLE = `---
title: 起動テストの記事
hashtags: [テスト]
---

## 見出しです

本文の **太字** と

- 箇条書き 1
- 箇条書き 2

https://example.com/embed-me

文の中のリンク https://example.com/in-text はそのまま。
`;

/** 拡張の safeClick と同じ手順(禁止文字の判定 → クリック)。テストのクリックもここを通す(AGENTS.md) */
async function safeClickLike(page: Page, selector: string) {
  const labels = await page.locator(selector).evaluate(collectClickLabels);
  assertClickAllowed(labels, selector);
  await page.locator(selector).click();
}

describe("拡張の起動と、ポップアップから下書きを作るまで(E2E)", () => {
  let context: BrowserContext;
  let userDataDir: string;
  let extensionId: string;
  let selectorsFetches = 0;

  before(async () => {
    assert.ok(existsSync(path.join(DIST, "manifest.json")), "extension/dist がありません。先に extension で npm run build をしてください");
    userDataDir = mkdtempSync(path.join(tmpdir(), "pigeon-e2e-"));
    // 拡張の service worker が出す通信(セレクタの取得)も context.route で止められるようにする
    process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
    context = await chromium.launchPersistentContext(userDataDir, {
      ...(executablePath ? { executablePath } : { channel: "chromium" }),
      headless: true,
      args: [
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
        // 差し替えが間に合わなかったときの保険。note と GitHub の名前を手元に向け、本物には届かないようにする
        "--host-resolver-rules=MAP note.com 127.0.0.1, MAP editor.note.com 127.0.0.1, MAP raw.githubusercontent.com 127.0.0.1",
      ],
    });
    // note には出ていかない。エディタは模擬ページを返す
    await context.route(/^https:\/\/(editor\.)?note\.com\//, (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: EDITOR }),
    );
    // セレクタは GitHub から取らせず、拡張に同梱した値(このビルドに入ったもの)を使わせる。
    // GitHub の main の状態に左右されず、同梱の値が壊れていれば気づける
    await context.route(/^https:\/\/raw\.githubusercontent\.com\//, (route) => {
      selectorsFetches++;
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
    extensionId = new URL(worker.url()).host;
  });
  after(async () => {
    await context?.close();
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  });

  it("service worker が起動し、ポップアップがエラーなく開く", async () => {
    assert.match(extensionId, /^[a-p]{32}$/);
    const popup = await context.newPage();
    const errors: string[] = [];
    popup.on("pageerror", (e) => errors.push(e.message));
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    assert.equal((await popup.locator("#submit").textContent())?.trim(), "note の下書きを作成");
    await popup.waitForTimeout(500);
    assert.deepEqual(errors, []);
    await popup.close();
  });

  /** ポップアップで md を選び、「note の下書きを作成」を押して、本文の確認待ちのバナーが出るまで進める */
  async function draftFromPopup(
    prepare: (popup: Page) => Promise<void> = async () => {},
    markdown = ARTICLE,
    waitBanner = "タイトル・本文・見出し画像を入れました",
  ): Promise<{ editor: Page; errors: string[] }> {
    const popup = await context.newPage();
    // 拡張が chrome.tabs.create で開いたタブの最初の読み込みは、Playwright の差し替え(route)より先に通ることがある
    // (CI で本物の note.com に出ていった)。テストでは一度 about:blank で開き、差し替えが効いてから note の URL に移す
    await popup.addInitScript(() => {
      // ルートの tsconfig には chrome の型が無いので、使う分だけ書く
      type Props = { url?: string; active?: boolean };
      type Tabs = {
        create: (p: Props) => Promise<{ id?: number }>;
        update: (id: number, p: Props) => Promise<unknown>;
      };
      const tabs = (globalThis as unknown as { chrome: { tabs: Tabs } }).chrome.tabs;
      const create = tabs.create.bind(tabs);
      tabs.create = async (props) => {
        const tab = await create({ ...props, url: "about:blank" });
        await new Promise((r) => setTimeout(r, 1_000));
        await tabs.update(tab.id!, { url: props.url });
        return tab;
      };
    });
    const errors: string[] = [];
    popup.on("pageerror", (e) => errors.push(e.message));
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.setInputFiles("#markdown-file", { name: "article.md", mimeType: "text/markdown", buffer: Buffer.from(markdown) });
    await popup.locator("#fields").waitFor({ state: "visible" });
    await prepare(popup);
    assert.ok((await popup.locator("#title").inputValue()).length > 0, "タイトルが読み取れていません");

    // 新しいタブは about:blank で作られてから note の URL に移るので、作られたあとで URL を待つ
    const editorPromise = context.waitForEvent("page", { timeout: 15_000 });
    await safeClickLike(popup, "#submit");
    const editor: Page = await editorPromise.catch(async (e) => {
      throw new Error(`note のタブが開きませんでした。ポップアップの表示: ${await popup.locator("#status").textContent()} (${(e as Error).message})`);
    });
    const logs: string[] = [];
    editor.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
    editor.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    await editor.waitForURL(/note\.com/, { timeout: 15_000 });

    // 本文の確認待ちのバナー(✅)が出るまで待つ。出なければ、原因を追えるようにバナーの中身とコンソールを出す
    const banner = editor.locator("#lastclick-pigeon-banner");
    await banner
      .getByText(waitBanner)
      .waitFor({ timeout: 30_000 })
      .catch(async (e) => {
        const text = await editor.evaluate(() => document.getElementById("lastclick-pigeon-banner")?.shadowRoot?.textContent ?? "(バナーなし)");
        throw new Error(`バナーが出ませんでした。URL: ${editor.url()} / バナー: ${text.replace(/\s+/g, " ").trim()} / コンソール: ${logs.join(" | ") || "(なし)"} (${(e as Error).message.split("\n")[0]})`);
      });

    return { editor, errors };
  }

  it("md ファイルを選んで「note の下書きを作成」を押すと、エディタにタイトルと本文が入って止まる", async () => {
    const { editor, errors } = await draftFromPopup();
    assert.equal(await editor.locator("#title").inputValue(), "起動テストの記事");
    // 作り終えたら、エディタのいちばん上に戻っている(貼り付けで最後まで動いた画面を戻す)
    assert.equal(await editor.evaluate(() => window.scrollY), 0);
    const body = await editor.locator("#body").innerHTML();
    assert.match(body, /<h2[^>]*>見出しです<\/h2>/);
    assert.match(body, /<strong>太字<\/strong>/);
    assert.match(body, /<li>箇条書き 1<\/li>/);
    // 既定で、URL だけの行は埋め込みになり、記事の先頭に目次が入る
    assert.match(body, /<figure/);
    assert.match(body, /class="toc"/);
    // 既定では、本文の最後に区切り線と「この記事は、Last One Click で下書きしました。」が入る
    assert.match(body, /<hr>\s*<p>この記事は、<a href="https:\/\/chromewebstore\.google\.com\/detail\/last-one-click\/jomapffkhcdpnodaffobmpfofnnaihnd">Last One Click<\/a> で下書きしました。<\/p>\s*$/);
    // GitHub への取得は止めたので、同梱のセレクタで最後まで通ったことになる
    assert.ok(selectorsFetches >= 1, "セレクタの取得が遮断されていません(GitHub から取っている可能性)");
    assert.deepEqual(errors, []);
  });
  it("「記事の先頭に目次を入れる」は既定でチェックありで、本文の先頭(本文より前)に目次が入る", async () => {
    const { editor, errors } = await draftFromPopup(async (popup) => {
      assert.equal(await popup.locator("#insert-toc").isChecked(), true, "既定はチェックあり");
    });
    const order = await editor.locator("#body").evaluate((b) => Array.from(b.children).map((c) => c.className || c.tagName));
    const toc = order.indexOf("toc");
    assert.ok(toc >= 0, `目次が入っていません: ${order.join(", ")}`);
    assert.ok(toc < order.indexOf("H2"), `目次が本文より前にありません: ${order.join(", ")}`);
    const banner = await editor.evaluate(() => document.getElementById("lastclick-pigeon-banner")?.shadowRoot?.textContent ?? "");
    assert.match(banner, /目次 ✓/);
    // チェックは次回も覚えている
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForFunction(() => (document.getElementById("insert-toc") as HTMLInputElement).checked, null, { timeout: 5_000 });
    await popup.close();
    assert.deepEqual(errors, []);
  });
  it("「URL だけの行を埋め込みにする」は既定でチェックありで、URL だけの行が埋め込みになり、文の中のリンクはそのまま", async () => {
    const { editor, errors } = await draftFromPopup(async (popup) => {
      assert.equal(await popup.locator("#embed-urls").isChecked(), true, "既定はチェックあり");
    });
    const cards = await editor.locator("#body figure.embed").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.url));
    assert.deepEqual(cards, ["https://example.com/embed-me"]);
    const lines = await editor.locator("#body > p").evaluateAll((els) => els.map((e) => e.textContent?.trim()));
    assert.ok(!lines.includes("https://example.com/embed-me"), `URL の行が残っています: ${lines.join(" / ")}`);
    assert.ok(lines.some((t) => t?.includes("https://example.com/in-text")), "文の中のリンクが消えました");
    const banner = await editor.evaluate(() => document.getElementById("lastclick-pigeon-banner")?.shadowRoot?.textContent ?? "");
    assert.match(banner, /埋め込み ✓\(1 件\)/);
    // チェックは次回も覚えている
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForFunction(() => (document.getElementById("embed-urls") as HTMLInputElement).checked, null, { timeout: 5_000 });
    await popup.close();
    assert.deepEqual(errors, []);
  });
  it("見出しの無い記事には、目次を入れずにバナーで知らせる", async () => {
    const { editor, errors } = await draftFromPopup(
      async (popup) => assert.equal(await popup.locator("#insert-toc").isChecked(), true),
      "---\ntitle: 見出しの無い記事\n---\n\n本文だけの記事です。\n",
    );
    assert.equal(await editor.locator("#body .toc").count(), 0);
    const banner = await editor.evaluate(() => document.getElementById("lastclick-pigeon-banner")?.shadowRoot?.textContent ?? "");
    assert.match(banner, /目次 —\(見出しが無いので入れていません\)/);
    assert.deepEqual(errors, []);
  });
  it("URL だけの行が上限(20 件)を超えたら、超えた件数をバナーで知らせる", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `https://example.com/many-${i + 1}`).join("\n\n");
    const { editor, errors } = await draftFromPopup(
      async (popup) => assert.equal(await popup.locator("#embed-urls").isChecked(), true),
      `---\ntitle: 上限のテスト\n---\n\n## 見出し\n\n${many}\n`,
      "一部は入力できませんでした",
    );
    assert.equal(await editor.locator("#body figure.embed").count(), 20);
    const banner = await editor.evaluate(() => document.getElementById("lastclick-pigeon-banner")?.shadowRoot?.textContent ?? "");
    assert.match(banner, /21 件あり、上限の 20 件を超えた 1 件は埋め込みにしていません/);
    assert.deepEqual(errors, []);
  });
  it("「記事の最後に…リンクを入れる」のチェックを外すと、リンクを入れない。チェックを覚える", async () => {
    const { editor, errors } = await draftFromPopup(async (popup) => {
      assert.equal(await popup.locator("#credit-link").isChecked(), true, "既定はチェックあり");
      // 「記事の設定」は既定でたたんであり、見出しの横にオンのものが出る
      assert.equal(await popup.locator("#article-options").getAttribute("open"), null);
      assert.equal(await popup.locator("#article-options-on").textContent(), "(目次・埋め込み・リンク)");
      await safeClickLike(popup, "#article-options > summary");
      await safeClickLike(popup, "#credit-link");
      assert.equal(await popup.locator("#article-options-on").textContent(), "(目次・埋め込み)");
      assert.equal(await popup.locator("#credit-link").isChecked(), false);
    });
    const body = await editor.locator("#body").innerHTML();
    assert.doesNotMatch(body, /下書きしました/);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForFunction(() => !(document.getElementById("credit-link") as HTMLInputElement).checked, null, { timeout: 5_000 });
    await popup.close();
    assert.deepEqual(errors, []);
  });
});
