// Playwright 版(tools/draft.ts)が、ビルドした拡張を読み込んで下書きを作る流れを、模擬の GitHub と note の画面で確かめる(#178)。
// tools/lib/extension.ts の関数を、tools/draft.ts と同じ順番で呼ぶ。note・GitHub には出ていかない
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { BrowserContext, Locator, Page } from "playwright";
import { collectClickLabels } from "./click-labels.js";
import { assertClickAllowed } from "./forbidden-click.js";
import { STORAGE } from "../extension/src/lib/types.js";
import {
  EXTENSION_DIST,
  bannerFailed,
  clearSelectorsCache,
  launchWithExtension,
  openPopup,
  overrideExtensionStorage,
  readBanner,
  bannerButton,
  saveDraft,
  submitFromPopup,
  waitBannerDone,
} from "../tools/lib/extension.js";

/** tools/draft.ts の safeClick と同じ(禁止の文字の検査 → クリック) */
async function testClick(locator: Locator, context: string) {
  const labels = await locator.evaluate(collectClickLabels);
  assertClickAllowed(labels, context);
  await locator.click();
}

/** 模擬の note のエディタ。貼り付けで本文に入れ、「下書き保存」で note の API に POST する */
const EDITOR = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>note</title></head><body>
  <textarea id="title" placeholder="記事タイトル"></textarea>
  <div id="body" class="ProseMirror" contenteditable="true"><p><br></p></div>
  <button id="save" type="button">下書き保存</button>
  <script>
    const body = document.getElementById("body");
    body.addEventListener("paste", (e) => {
      e.preventDefault();
      const t = document.createElement("template");
      t.innerHTML = e.clipboardData.getData("text/html");
      body.replaceChildren(t.content);
    });
    document.getElementById("save").addEventListener("click", async () => {
      await fetch("https://note.com/api/v1/text_notes/draft_save", { method: "POST", body: "{}" });
      document.getElementById("save").dataset.saved = "1";
    });
  </script>
</body></html>`;

const MD = "---\ntitle: Playwright 版のテスト\nhashtags: [テスト]\n---\n\n## 見出し\n\n本文です。\n";

describe("Playwright 版が拡張を動かして下書きを作る(#178)", { skip: !existsSync(path.join(EXTENSION_DIST, "manifest.json")) && "extension/dist がありません" }, () => {
  let ctx: BrowserContext;
  let extensionId: string;
  let dir: string;
  const saves: string[] = [];

  before(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "pigeon-driver-"));
    ({ ctx, extensionId } = await launchWithExtension({
      profileDir: path.join(dir, "profile"),
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      // 差し替えが間に合わなかったときの保険。本物の note と GitHub には届かないようにする
      args: ["--host-resolver-rules=MAP note.com 127.0.0.1, MAP editor.note.com 127.0.0.1, MAP raw.githubusercontent.com 127.0.0.1, MAP api.github.com 127.0.0.1"],
    }));
    await ctx.route(/^https:\/\/raw\.githubusercontent\.com\/o\/r\//, (route) => {
      const url = route.request().url();
      if (url.endsWith("/posts/ok/article.md")) return route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: MD });
      if (url.endsWith("/posts/blog/article.md")) return route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: "---\ntitle: ブログの記事\ntarget: blog\n---\n\n本文\n" });
      return route.fulfill({ status: 404, body: "" });
    });
    await ctx.route(/^https:\/\/(editor\.)?note\.com\//, (route) => {
      const req = route.request();
      if (req.url().includes("/api/")) {
        if (req.method() === "POST") saves.push(req.url());
        return route.fulfill({ status: req.method() === "POST" ? 200 : 404, contentType: "application/json", body: "{}" });
      }
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: EDITOR });
    });
  });
  after(async () => {
    await ctx?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** tools/draft.ts と同じく、拡張の設定をこの実行のあいだだけ変えてから、ポップアップを開き直す */
  async function preparedPopup(skipBodyReview: boolean): Promise<{ popup: Page; restore: () => Promise<void> }> {
    const popup = await openPopup(ctx, extensionId);
    // 拡張が chrome.tabs.create で開いたタブの最初の読み込みは、差し替え(route)より先に通ることがあるので、
    // about:blank で開いてから note の URL に移す(shared/extension-e2e.dom.test.ts と同じ)
    await popup.addInitScript(() => {
      type Props = { url?: string; active?: boolean };
      type Tabs = { create: (p: Props) => Promise<{ id?: number }>; update: (id: number, p: Props) => Promise<unknown> };
      const tabs = (globalThis as unknown as { chrome: { tabs: Tabs } }).chrome.tabs;
      const create = tabs.create.bind(tabs);
      tabs.create = async (props) => {
        const tab = await create({ ...props, url: "about:blank" });
        await new Promise((r) => setTimeout(r, 1_000));
        await tabs.update(tab.id!, { url: props.url });
        return tab;
      };
    });
    const restore = await overrideExtensionStorage(popup, {
      [STORAGE.advancedMode]: true,
      [STORAGE.skipBodyReview]: skipBodyReview,
      [STORAGE.creditLink]: false,
      // 模擬のエディタには目次のメニューが無いので、目次は入れない
      [STORAGE.insertToc]: false,
    });
    await clearSelectorsCache(popup);
    await popup.reload();
    return { popup, restore };
  }

  it("--save と同じ流れ: 拡張が入れ終わるのを待ち、「下書き保存」を押して、保存の印を残す。拡張の設定は元に戻す", async () => {
    const { popup, restore } = await preparedPopup(false);
    const editor = await submitFromPopup(popup, "https://github.com/o/r/tree/main/posts/ok", testClick);
    await restore();
    // 設定は元に戻っている(上級者向けの表示は、もともと無かった)
    const stored = await popup.evaluate(async (k) => (globalThis as unknown as { chrome: { storage: { local: { get: (k: string) => Promise<Record<string, unknown>> } } } }).chrome.storage.local.get(k), STORAGE.advancedMode);
    assert.equal(stored[STORAGE.advancedMode], undefined);
    await popup.close();

    const logs: string[] = [];
    editor.on("console", (m) => logs.push(m.text()));
    const result = await waitBannerDone(editor, 30_000).catch((e) => {
      throw new Error(`${(e as Error).message} / URL: ${editor.url()} / コンソール: ${logs.join(" | ")}`);
    });
    assert.equal(result.state, "ok", result.text);
    assert.equal(bannerFailed(result), false);
    assert.match(result.text, /タイトル・本文・見出し画像を入れました/);
    assert.equal(await editor.locator("#title").inputValue(), "Playwright 版のテスト");
    assert.match(await editor.locator("#body").innerText(), /本文です。/);

    const marker = path.join(dir, "saved", "ok.txt");
    process.env.LOC_SAVED_MARKER = marker;
    try {
      await saveDraft(editor, testClick);
    } finally {
      delete process.env.LOC_SAVED_MARKER;
    }
    assert.equal(saves.length, 1);
    assert.match(readFileSync(marker, "utf8"), /note\.com/);
    // バナーは、入れ終わった状態のまま(拡張は「下書き保存」を押していない。押したのは Playwright 版)
    assert.equal((await readBanner(editor))?.state, "ok");
    // --hold は、このあとバナーの「公開設定を入れる」を押す(ボタンが見つかること)
    assert.equal((await (await bannerButton(editor, "公開設定を入れる")).textContent())?.trim(), "公開設定を入れる");
    await assert.rejects(bannerButton(editor, "投稿する"), /ありません/);
    await editor.close();
  });

  it("入れる先と合わない記事(target: blog)は、下書きを作らずにポップアップの理由で止まる", async () => {
    const { popup, restore } = await preparedPopup(false);
    try {
      await assert.rejects(submitFromPopup(popup, "https://github.com/o/r/tree/main/posts/blog", testClick), /下書きを作れません.*target/s);
    } finally {
      await restore();
      await popup.close();
    }
  });

  it("読み込めない記事は、ポップアップのエラーの文で止まる", async () => {
    const { popup, restore } = await preparedPopup(false);
    try {
      await assert.rejects(submitFromPopup(popup, "https://github.com/o/r/tree/main/posts/missing", testClick), /記事を読み込めませんでした.*404/s);
    } finally {
      await restore();
      await popup.close();
    }
  });
});
