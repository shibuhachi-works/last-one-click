// 追加の対応先の編集画面への入力(extension/src/lib/extra-site-fill.ts。#120)を、#119 の診断の作りをまねた見本の DOM で確かめる。
// タイトル・本文・本文の画像・見出し画像・タグが入ること、「確認画面へ」「下書き保存」は押さないこと、gif は入れずに知らせること
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildSync } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

/**
 * 見本の編集画面。本文の欄は、貼り付けの text/html を自分で入れ直す(Lexical のまね)。
 * 本文の画像の欄・見出し画像の欄は、change で <img> を足す。タグの欄は Enter でタグを足して空になる。
 * 記事の設定は、開くボタンを押すまでたたまれている
 */
const PAGE = `<!doctype html><html><body>
  <form id="form" onsubmit="window.__submitted++; return false">
    <input type="text" id="title" name="title" placeholder="タイトル">
    <div class="ContentEditable__root" data-lexical-editor="true" contenteditable="true"><p><br></p></div>
    <input type="file" id="fileInputForEditor" accept=".png,.jpg,.jpeg" style="display:none">
    <div id="article_setting_menu">
      <div class="article_setting_menu_index" role="button">記事の設定</div>
      <div id="setting_body" style="display:none">
        <input type="file" id="fileInput" class="js_dragDropFileInput" accept="image/*" style="display:none">
        <div id="eyecatch_preview"></div>
        <textarea id="summary"></textarea>
        <div id="tags"></div>
        <input type="text" placeholder="タグを入力">
        <label><input type="radio" name="setting_publishScope" value="all">全体</label>
      </div>
    </div>
    <button type="button" id="save">下書き保存</button>
    <button type="button" id="confirm">確認画面へ</button>
  </form>
  <script>
    window.__clicks = [];
    window.__submitted = 0;
    document.addEventListener("click", (e) => {
      const b = e.target.closest("button, [role=button]");
      if (b) window.__clicks.push(b.id || b.className);
    }, true);
    document.querySelector(".article_setting_menu_index").addEventListener("click", () => {
      document.getElementById("setting_body").style.display = "block";
    });
    const body = document.querySelector("[data-lexical-editor]");
    body.addEventListener("paste", (e) => {
      e.preventDefault();
      const html = e.clipboardData.getData("text/html");
      const doc = new DOMParser().parseFromString(html, "text/html");
      body.replaceChildren(...Array.from(doc.body.childNodes));
    });
    document.getElementById("fileInputForEditor").addEventListener("change", (e) => {
      const f = e.target.files[0];
      const sel = getSelection();
      const img = document.createElement("img");
      img.src = "https://example.com/uploaded/" + f.name;
      img.dataset.name = f.name;
      const r = sel.getRangeAt(0);
      r.collapse(false);
      r.insertNode(img);
    });
    document.getElementById("fileInput").addEventListener("change", (e) => {
      const img = document.createElement("img");
      img.dataset.name = e.target.files[0].name;
      document.getElementById("eyecatch_preview").append(img);
    });
    const tag = document.querySelector('input[placeholder="タグを入力"]');
    tag.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !tag.value) return;
      const s = document.createElement("span");
      s.textContent = tag.value;
      document.getElementById("tags").append(s);
      tag.value = "";
    });
  </script>
</body></html>`;

/** 拡張の入力を、ページで動く 1 つの関数にまとめる */
function bundle(): string {
  const out = buildSync({
    stdin: {
      contents: `import { fillExtraSite } from "./extension/src/lib/extra-site-fill"; globalThis.__fill = fillExtraSite;`,
      resolveDir: new URL("..", import.meta.url).pathname,
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    write: false,
  });
  return out.outputFiles[0]!.text;
}

/** 1×1 の画像の中身(中身は見ないので何でもよい) */
const B64 = Buffer.from("not really an image").toString("base64");

const ARTICLE = {
  title: "見本のタイトル",
  hashtags: ["#一つめ", "二つめ"],
  html: `<h2>見出し</h2><p>前の段落</p><p>［画像1・ab12: a.png］</p><p>［画像2・ab12: b.gif］</p><p>後の段落</p>`,
  thumbnail: { name: "eyecatch.png", mimeType: "image/png", base64: B64 },
  images: [
    { marker: "［画像1・ab12: a.png］", name: "a.png", mimeType: "image/png", base64: B64 },
    { marker: "［画像2・ab12: b.gif］", name: "b.gif", mimeType: "image/gif", base64: B64 },
  ],
};

type Run = {
  result: { ok: boolean; lines: string[] } | null;
  error: string | null;
  title: string;
  body: string;
  bodyImages: string[];
  eyecatch: string[];
  tags: string[];
  clicks: string[];
  submitted: number;
  summary: string;
  scope: boolean;
};

describe("追加の対応先の編集画面に入れる (DOM)", () => {
  let browser: Browser;
  let page: Page;
  const src = bundle();

  before(async () => {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
    page = await browser.newPage();
  });
  after(async () => {
    await browser?.close();
  });
  beforeEach(async () => {
    await page.goto("about:blank");
    await page.setContent(PAGE);
    await page.addScriptTag({ content: src });
  });

  async function run(article: unknown, opts: Record<string, unknown> = {}): Promise<Run> {
    return page.evaluate(
      async ({ article, opts }) => {
        let result = null;
        let error = null;
        try {
          result = await (globalThis as any).__fill(article, ["見本の知らせ"], { imageWaitMs: 1000, fieldWaitMs: 1000, ...opts });
        } catch (e) {
          error = (e as Error).message;
        }
        const body = document.querySelector("[data-lexical-editor]")!;
        return {
          result,
          error,
          title: (document.getElementById("title") as HTMLInputElement).value,
          body: body.textContent ?? "",
          bodyImages: Array.from(body.querySelectorAll("img"), (i) => (i as HTMLElement).dataset.name ?? ""),
          eyecatch: Array.from(document.querySelectorAll("#eyecatch_preview img"), (i) => (i as HTMLElement).dataset.name ?? ""),
          tags: Array.from(document.querySelectorAll("#tags span"), (s) => s.textContent ?? ""),
          clicks: (window as any).__clicks,
          submitted: (window as any).__submitted,
          summary: (document.getElementById("summary") as HTMLTextAreaElement).value,
          scope: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="setting_publishScope"]')).some((r) => r.checked),
        };
      },
      { article, opts },
    );
  }

  it("タイトル・本文・本文の画像・見出し画像・タグを入れる", async () => {
    const r = await run(ARTICLE);
    assert.equal(r.error, null);
    assert.equal(r.title, "見本のタイトル");
    assert.match(r.body, /見出し前の段落/);
    assert.match(r.body, /後の段落/);
    assert.deepEqual(r.bodyImages, ["a.png"]);
    assert.doesNotMatch(r.body, /画像1・ab12/, "入れた画像の目印は消す");
    assert.deepEqual(r.eyecatch, ["eyecatch.png"]);
    assert.deepEqual(r.tags, ["一つめ", "二つめ"]);
    assert.equal(r.result!.ok, true);
    assert.ok(r.result!.lines.some((l) => l === "✓ タグ: 2 個"), r.result!.lines.join("\n"));
    assert.ok(r.result!.lines.includes("⚠ このページでは入らない書き方: 見本の知らせ"));
  });

  it("gif は入れずに目印を残し、知らせる", async () => {
    const r = await run(ARTICLE);
    assert.match(r.body, /［画像2・ab12: b\.gif］/);
    assert.ok(!r.bodyImages.includes("b.gif"));
    const line = r.result!.lines.find((l) => l.includes("本文の画像"));
    assert.match(line ?? "", /^⚠ 本文の画像: 1 枚は入れました。.*png・jpg だけ.*b\.gif/);
  });

  it("押すのは記事の設定を開くボタンだけ。「確認画面へ」「下書き保存」は押さず、フォームも送らない", async () => {
    const r = await run(ARTICLE);
    assert.deepEqual(r.clicks, ["article_setting_menu_index"]);
    assert.equal(r.submitted, 0);
  });

  it("要約・公開範囲には触らない", async () => {
    const r = await run(ARTICLE);
    assert.equal(r.summary, "");
    assert.equal(r.scope, false);
  });

  it("開くボタンのセレクタが「下書き保存」「確認画面へ」に当たっても押さない", async () => {
    for (const sel of ["#save", "#confirm"]) {
      await page.setContent(PAGE);
      await page.addScriptTag({ content: src });
      const r = await run(
        { ...ARTICLE, images: [] },
        {
          selectors: {
            title: ["#title"],
            body: ["[data-lexical-editor]"],
            bodyImageInput: ["#fileInputForEditor"],
            settingsMenu: ["#article_setting_menu"],
            settingsMenuOpenButton: [sel],
            eyecatchInput: ["#fileInput"],
            tagInput: ['input[placeholder*="タグ"]'],
          },
        },
      );
      assert.deepEqual(r.clicks, [], sel);
      assert.equal(r.result!.ok, false);
      assert.ok(r.result!.lines.some((l) => l.startsWith("✗ 記事の設定を開く") && l.includes("押しません")), r.result!.lines.join("\n"));
    }
  });

  it("本文の欄が無ければ、本文の画像は入れずに ✗ を出す", async () => {
    await page.setContent(`<!doctype html><html><body><input id="title"></body></html>`);
    await page.addScriptTag({ content: src });
    const r = await page.evaluate(async (article) => {
      return (globalThis as any).__fill(article, [], { fieldWaitMs: 200, imageWaitMs: 200 });
    }, { ...ARTICLE, thumbnail: undefined, hashtags: [] });
    assert.equal(r.ok, false);
    assert.ok(r.lines.some((l: string) => l.startsWith("✗ 本文")));
    assert.ok(!r.lines.some((l: string) => l.includes("本文の画像")));
  });
});
