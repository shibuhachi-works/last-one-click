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
import { chromium, type BrowserContext, type Page, type Route } from "playwright";
import { collectClickLabels } from "./click-labels.js";
import { makeZip } from "./zip-fixture.test.js";
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
      // 画像のファイルを貼ると、選んでいた文字を消して、その行の後ろに画像を入れる。
      // いったん blob: の画像が入り、アップロードが終わると https の URL に変わる(2026-11-10 実機: figure.image、assets.st-note.com)
      if (e.clipboardData.files.length) {
        const sel = getSelection();
        const b = caretBlock();
        if (sel && sel.rangeCount && !sel.isCollapsed) sel.getRangeAt(0).deleteContents();
        const fig = document.createElement("figure");
        fig.className = "image";
        const img = document.createElement("img");
        img.src = URL.createObjectURL(e.clipboardData.files[0]);
        // 画像の下にキャプションの欄が付く(実機: figcaption。空のあいだは「キャプションを入力」)
        // ProseMirror の空の行と同じく、空の欄には <br> が入っている
        const cap = document.createElement("figcaption");
        cap.append(document.createElement("br"));
        fig.append(img, cap);
        if (b && b.tagName === "P" && b.textContent.trim() === "") b.replaceWith(fig);
        else (b ?? body.lastElementChild).after(fig);
        // 名前が late- で始まる画像は、アップロードに 31 秒かかる(拡張が待つ 30 秒を過ぎてから入る。2026-11-13 実機の gif と同じ)
        const name = e.clipboardData.files[0].name;
        setTimeout(() => (img.src = "https://assets.example.com/" + name), name.startsWith("late-") ? 31_000 : 300);
        return;
      }
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
    bannerTimeout = 30_000,
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
      .waitFor({ timeout: bannerTimeout })
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
  /** ポップアップに、md と画像のファイルをまとめてドロップする(人がファインダーから落としたのと同じ drop イベント) */
  async function dropFiles(popup: Page, markdown: string, images: string[]) {
    await popup.evaluate(
      async ({ markdown, images }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([markdown], "article.md", { type: "text/markdown" }));
        for (const name of images) {
          const c = document.createElement("canvas");
          c.width = 8;
          c.height = 8;
          const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
          dt.items.add(new File([blob!], name, { type: "image/png" }));
        }
        document.body.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      },
      { markdown, images },
    );
    await popup.waitForFunction(() => /本文の画像|見出し画像|md ファイル/.test(document.getElementById("status")?.textContent ?? ""), null, { timeout: 5_000 });
  }

  it("md と一緒にドロップした画像を、本文の ![説明](ファイル名) の位置に入れる。md に無い画像は見出し画像になる", async () => {
    const md = "---\ntitle: 画像のテスト\n---\n\n## 見出し\n\n前の段落\n\n![図1](fig1.png \"図1 のキャプション\")\n\n後ろの段落\n";
    const { editor, errors } = await draftFromPopup(async (popup) => {
      assert.equal(await popup.locator("#insert-images").isChecked(), true, "既定はチェックあり");
      await dropFiles(popup, md, ["fig1.png", "cover.png"]);
      const picked = (await popup.locator("#picked").textContent()) ?? "";
      assert.match(picked, /見出し画像: cover\.png/);
      assert.match(picked, /本文の画像: 1 枚/);
      // 模擬のエディタには見出し画像のボタンが無いので、見出し画像は外しておく(振り分けは上で確かめた)
      await popup.evaluate(() => {
        const input = document.getElementById("thumbnail") as HTMLInputElement;
        input.files = new DataTransfer().files;
      });
    }, md);
    await editor.locator("#body figure.image img[src='https://assets.example.com/fig1.png']").waitFor({ timeout: 10_000 });
    const order = await editor.locator("#body").evaluate((b) => Array.from(b.children).map((c) => c.tagName + ":" + (c.textContent ?? "").trim()));
    const fig = order.findIndex((x) => x.startsWith("FIGURE"));
    assert.ok(fig > order.findIndex((x) => x.includes("前の段落")) && fig < order.findIndex((x) => x.includes("後ろの段落")), order.join(" | "));
    assert.doesNotMatch(await editor.locator("#body").innerText(), /［画像1/, "目印は消える");
    // md の "…"(title)は、画像のキャプションに入る(alt の「図1」は入れない)
    assert.equal((await editor.locator("#body figure.image figcaption").textContent())?.trim(), "図1 のキャプション");
    const banner = await editor.evaluate(() => document.getElementById("lastclick-pigeon-banner")?.shadowRoot?.textContent ?? "");
    assert.match(banner, /本文の画像 ✓\(1 枚\)/);
    assert.deepEqual(errors, []);
  });

  it("記事の ZIP をドロップすると、中の md を読み、本文の画像と front matter の thumbnail を振り分ける", async () => {
    const md = "---\ntitle: ZIP のテスト\nthumbnail: ./thumbnail.png\n---\n\n## 見出し\n\n![図1](img/fig1.png)\n";
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const zip = makeZip([
      { name: "post/article.md", data: md },
      { name: "post/README.md", data: "# 説明" },
      { name: "post/img/fig1.png", data: png, store: true },
      { name: "post/thumbnail.png", data: png },
      { name: "post/unused.png", data: png },
    ]);
    const { editor, errors } = await draftFromPopup(async (popup) => {
      await popup.evaluate(async (bytes) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytes)], "post.zip", { type: "application/zip" }));
        document.body.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, [...zip]);
      await popup.waitForFunction(() => /post\.zip から/.test(document.getElementById("status")?.textContent ?? ""), null, { timeout: 5_000 });
      const status = (await popup.locator("#status").textContent()) ?? "";
      assert.match(status, /md ファイル: post\/article\.md/);
      assert.match(status, /見出し画像: thumbnail\.png/);
      assert.match(status, /本文の画像: 1 枚/);
      assert.equal(await popup.locator("#title").inputValue(), "ZIP のテスト");
      // 模擬のエディタには見出し画像のボタンが無いので、見出し画像は外しておく(振り分けは上で確かめた)
      await popup.evaluate(() => {
        (document.getElementById("thumbnail") as HTMLInputElement).files = new DataTransfer().files;
      });
    }, md);
    await editor.locator("#body figure.image img[src='https://assets.example.com/fig1.png']").waitFor({ timeout: 10_000 });
      assert.deepEqual(errors, []);
    });

  it("同じ画像を 2 回使っても、それぞれのキャプションに入る", async () => {
    const md = "---\ntitle: キャプションのテスト\n---\n\n## 見出し\n\n![a](fig1.png \"1 つ目\")\n\n間の段落\n\n![b](fig1.png \"2 つ目\")\n";
    const { editor, errors } = await draftFromPopup(async (popup) => {
      await dropFiles(popup, md, ["fig1.png"]);
    }, md);
    await editor.locator("#body figure.image").nth(1).waitFor({ timeout: 10_000 });
    const caps = await editor.locator("#body figure.image figcaption").allTextContents();
    assert.deepEqual(caps.map((c) => c.trim()), ["1 つ目", "2 つ目"]);
    assert.deepEqual(errors, []);
  });

  it("アップロードに 30 秒より長くかかって遅れて入った画像も、最後に確かめて目印を消し、キャプションを入れる", async () => {
    const md = "---\ntitle: 遅い画像のテスト\n---\n\n## 見出し\n\n![動き](late-demo.png \"遅れて入る画像\")\n";
    const { editor, errors } = await draftFromPopup(
      async (popup) => {
        await dropFiles(popup, md, ["late-demo.png"]);
      },
      md,
      "タイトル・本文・見出し画像を入れました",
      70_000,
    );
    await editor.locator("#body figure.image img[src='https://assets.example.com/late-demo.png']").waitFor({ timeout: 5_000 });
    assert.doesNotMatch(await editor.locator("#body").innerText(), /［画像1・/, "遅れて入った画像の目印が残っています");
    assert.deepEqual((await editor.locator("#body figure.image figcaption").allTextContents()).map((c) => c.trim()), ["遅れて入る画像"]);
    const banner = await editor.evaluate(() => document.getElementById("lastclick-pigeon-banner")?.shadowRoot?.textContent ?? "");
    assert.match(banner, /本文の画像 ✓\(1 枚\)/);
    assert.deepEqual(errors, []);
  });

  it("本文の画像が見つからないときは、目印を残してバナーで知らせる", async () => {
    const md = "---\ntitle: 画像が無いテスト\n---\n\n## 見出し\n\n![図](missing.png)\n";
    const { editor, errors } = await draftFromPopup(async () => {}, md, "一部は入力できませんでした");
    assert.match(await editor.locator("#body").innerText(), /［画像1・[0-9a-z]{4}: missing\.png］/);
    const banner = await editor.evaluate(() => document.getElementById("lastclick-pigeon-banner")?.shadowRoot?.textContent ?? "");
    assert.match(banner, /見つからなかった画像があります\(missing\.png\)/);
    assert.doesNotMatch(banner, /0 枚は入れました/, "1 枚も入らなかったときは枚数を出さない");
    assert.deepEqual(errors, []);
  });

  it("GitHub から読み込んだ記事は、読み込んだ内容を少し直しても、本文の画像を同じフォルダから取る", async () => {
    const md = "---\ntitle: GitHub の画像のテスト\n---\n\n## 見出し\n\n![図](fig1.png)\n";
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    // この記事のフォルダだけ返す(ほかの raw は、これまでどおり止める)。後から足した route が先に効く
    const handler = (route: Route) => {
      const url = route.request().url();
      if (url.endsWith("/posts/img-test/article.md")) return route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: md });
      if (url.endsWith("/posts/img-test/fig1.png")) return route.fulfill({ status: 200, contentType: "image/png", body: png });
      return route.fallback();
    };
    await context.route(/^https:\/\/raw\.githubusercontent\.com\/o\/r\/main\/posts\/img-test\//, handler);
    try {
      const { editor, errors } = await draftFromPopup(async (popup) => {
        await safeClickLike(popup, "details:has(#advanced-toggle) > summary");
        await safeClickLike(popup, "#advanced-toggle");
        await popup.locator("#github-url").fill("https://github.com/o/r/tree/main/posts/img-test");
        await safeClickLike(popup, "#github-load");
        await popup.waitForFunction(() => (document.getElementById("title") as HTMLInputElement).value === "GitHub の画像のテスト", null, { timeout: 10_000 });
        // 読み込んだ内容を一文字直す(取得元は残る)
        await popup.locator("#markdown").focus();
        await popup.keyboard.press("End");
        await popup.keyboard.type("追記");
      }, md);
      await editor.locator("#body figure.image img[src='https://assets.example.com/fig1.png']").waitFor({ timeout: 10_000 });
      assert.doesNotMatch(await editor.locator("#body").innerText(), /［画像1/);
      assert.deepEqual(errors, []);
    } finally {
      await context.unroute(/^https:\/\/raw\.githubusercontent\.com\/o\/r\/main\/posts\/img-test\//, handler);
      // 上級者向けの表示は覚えられるので、ほかのテストに残さない
      const p = await context.newPage();
      await p.goto(`chrome-extension://${extensionId}/popup.html`);
      await p.evaluate(() => (globalThis as unknown as { chrome: { storage: { local: { remove: (k: string) => Promise<void> } } } }).chrome.storage.local.remove("advancedMode"));
      await p.close();
    }
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
  it("「記事の最後に…リンクと #LastOneClick を入れる」は外に出ていて既定はチェックあり。本文の最後にリンク、ハッシュタグに LastOneClick が入る。外すと入らず、チェックを覚える", async () => {
    let first: Page | undefined;
    const { editor, errors } = await draftFromPopup(async (popup) => {
      first = popup;
      // 作成を押したときに保存される記事(ハッシュタグ)を、あとで読めるように控えておく
      await popup.evaluate(() => {
        type Change = Record<string, { newValue?: { hashtags?: string[] } }>;
        const c = (globalThis as unknown as { chrome: { storage: { onChanged: { addListener: (f: (ch: Change) => void) => void } } } }).chrome;
        c.storage.onChanged.addListener((ch) => {
          const tags = ch.pendingArticle?.newValue?.hashtags;
          if (tags) (globalThis as unknown as { __tags: string[] }).__tags = tags;
        });
      });
      const credit = popup.locator("#credit-link");
      assert.equal(await credit.isChecked(), true, "既定はチェックあり");
      // 「記事の設定」の中ではなく、たたまれていない所にあり、文言にリンクとハッシュタグの両方が書いてある
      assert.equal(await popup.locator("#article-options #credit-link").count(), 0);
      assert.ok(await credit.isVisible());
      assert.match((await popup.locator("label:has(#credit-link)").textContent()) ?? "", /リンクと、ハッシュタグ #LastOneClick を入れる/);
      // 「記事の設定」の見出しの横には、リンクは出ない
      assert.equal(await popup.locator("#article-options-on").textContent(), "(目次・埋め込み・画像)");
    });
    const body = await editor.locator("#body").innerHTML();
    assert.match(body, /<hr>\s*<p>この記事は、<a href="https:\/\/chromewebstore\.google\.com\/detail\/last-one-click\/jomapffkhcdpnodaffobmpfofnnaihnd">Last One Click<\/a> で下書きしました。<\/p>\s*$/);
    // 公開設定で入れるハッシュタグに LastOneClick が足されている(md のハッシュタグはテスト)
    const tags = await first!.evaluate(() => (globalThis as unknown as { __tags?: string[] }).__tags);
    assert.deepEqual(tags, ["テスト", "LastOneClick"]);
    assert.deepEqual(errors, []);

    // チェックを外すと、リンクもハッシュタグも入らない。外したことを覚える
    const second = await draftFromPopup(async (popup) => {
      await safeClickLike(popup, "#credit-link");
      assert.equal(await popup.locator("#credit-link").isChecked(), false);
    });
    assert.doesNotMatch(await second.editor.locator("#body").innerHTML(), /下書きしました/);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForFunction(() => !(document.getElementById("credit-link") as HTMLInputElement).checked, null, { timeout: 5_000 });
    // 後のテストに残さないよう、チェックを戻しておく
    await safeClickLike(popup, "#credit-link");
    await popup.close();
    assert.deepEqual(second.errors, []);
  });
});
