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
        <textarea id="summary" maxlength="140"></textarea>
        <div class="article_setting_item article_tag_input">
          <div class="article_tag_inputArea" id="tags"><input type="text" placeholder="タグを追加してください"></div>
          <div class="article_tag_suggest"><ul><li><button type="button" class="article_tag_suggest_item">#一つめ</button></li></ul><div id="typing"></div></div>
        </div>
        <label><input type="radio" id="publishScope_limited" name="setting_publishScope">冒頭のみ公開 投稿者名とアイコンは匿名表示</label>
        <label><input type="radio" id="publishScope_public" name="setting_publishScope">全文公開 投稿者名もアイコンもすべて表示</label>
        <label class="switch"><input type="checkbox" id="setting_estimatedReadingTime" style="display:none">読了目安時間を表示する</label>
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
      const r = sel.getRangeAt(0).cloneRange();
      r.collapse(false);
      // 名前が slow で始まる画像は、遅れて入る(アップロードに時間がかかったときのまね)
      if (f.name.startsWith("slow")) setTimeout(() => r.insertNode(img), 1500);
      else r.insertNode(img);
    });
    document.getElementById("fileInput").addEventListener("change", (e) => {
      const img = document.createElement("img");
      img.dataset.name = e.target.files[0].name;
      document.getElementById("eyecatch_preview").append(img);
    });
    let tag = document.querySelector('input[placeholder="タグを追加してください"]');
    // 足したタグは、実機と同じく入力欄の前の button.tagItems(「#タグ」と × の印)
    function addChip(text) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tagItems";
      b.textContent = "#" + text;
      const x = document.createElement("i");
      x.className = "fa-solid fa-xmark";
      b.append(x);
      tag.before(b);
    }
    // ページが記事の設定を作り直したときのまね: 足したタグと、候補の選ばれた印を消す。__tagRebuild なら入力欄も作り直す
    function vanish() {
      document.querySelectorAll("#tags .tagItems").forEach((c) => c.remove());
      document.querySelectorAll(".article_tag_suggest_item.is_selected").forEach((b) => b.classList.remove("is_selected"));
      if (window.__tagRebuild) {
        const fresh = tag.cloneNode(true);
        window.__tagRebuild = false;
        tag.replaceWith(fresh);
        tag = fresh;
        listen();
      }
    }
    // 公認タグの候補を押すと、そのタグが足される(実機の「クリックするとタグが追加されます」のまね)
    document.querySelectorAll(".article_tag_suggest_item").forEach((b) => b.addEventListener("click", () => {
      if (b.classList.contains("is_selected")) return;
      b.classList.add("is_selected");
      addChip(b.textContent.replace(/^#/, ""));
    }));
    function listen() {
      // 打っている途中は、候補の並びに打った文字を出す(入ったと取り違えないかを見るため)
      tag.addEventListener("input", () => { document.getElementById("typing").textContent = tag.value; });
      // keyCode で Enter を見る(KeyboardEvent の初期値の keyCode は 0)。window.__tagBroken なら Enter で欄を空にするだけ
      tag.addEventListener("keydown", (e) => {
        if (e.keyCode !== 13 || !tag.value) return;
        if (window.__tagBroken) { tag.value = ""; return; }
        // window.__tagVanish なら、足したタグを少しあとで消す(実機で、いったん入ったタグが消えたときのまね)
        // window.__tagVanishAlways なら、入れるたびに消す。window.__tagRebuild なら、一度だけタグの欄ごと作り直す
        if ((window.__tagVanish || window.__tagRebuild) && !window.__vanishSet) { window.__vanishSet = true; setTimeout(vanish, 1800); }
        if (window.__tagVanishAlways) setTimeout(vanish, 1800);
        addChip(tag.value);
        tag.value = "";
      });
      // 手で Enter を押したときに来ない keypress・change が来たら、足したタグを外す
      // (実機で、拡張が入れたタグだけが消えたときのまね。拡張は keydown と input だけを送ること)
      tag.addEventListener("keypress", (e) => { if (e.keyCode === 13) document.querySelector("#tags .tagItems:last-of-type")?.remove(); });
      tag.addEventListener("change", () => { document.querySelectorAll("#tags .tagItems").forEach((c) => c.remove()); });
    }
    listen();
  </script>
</body></html>`;

/** 拡張の入力を、ページで動く 1 つの関数にまとめる */
function bundle(): string {
  const out = buildSync({
    stdin: {
      contents: `import { fillExtraSite, resultMessage } from "./extension/src/lib/extra-site-fill"; globalThis.__fill = fillExtraSite; globalThis.__result = resultMessage;`,
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
  scope: string;
  readingTime: boolean;
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
          result = await (globalThis as any).__fill(article, ["見本の知らせ"], { imageWaitMs: 1000, fieldWaitMs: 1000, settleQuietMs: 100, settleMaxMs: 1000, ...opts });
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
          tags: Array.from(document.querySelectorAll("#tags .tagItems"), (s) => (s.textContent ?? "").replace(/^#/, "")),
          clicks: (window as any).__clicks,
          submitted: (window as any).__submitted,
          summary: (document.getElementById("summary") as HTMLTextAreaElement).value,
          scope: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="setting_publishScope"]')).find((r) => r.checked)?.id ?? "",
          readingTime: (document.getElementById("setting_estimatedReadingTime") as HTMLInputElement).checked,
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
    assert.ok(r.result!.lines.includes("⚠ library.libecity.com のエディタでは入らない書き方: 見本の知らせ"));
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
    // 公認タグの候補(#一つめ)は、候補のボタンを押して入れる
    assert.deepEqual(r.clicks, ["article_setting_menu_index", "article_tag_suggest_item"]);
    assert.equal(r.submitted, 0);
  });

  it("要約が無ければ要約の欄に触らない。公開範囲には触らない。結果に、入れていない欄を出す", async () => {
    const r = await run(ARTICLE);
    assert.equal(r.summary, "");
    assert.equal(r.scope, "");
    assert.match(await page.evaluate((res) => (globalThis as any).__result(res).text, r.result), /要約・カテゴリ・外部公開の範囲は入れていません/);
  });

  it("front matter の summary を要約の欄に入れ、カテゴリは入れずに知らせる", async () => {
    const r = await run({ ...ARTICLE, summary: "見本の要約です。", category: "見本のカテゴリ" });
    assert.equal(r.summary, "見本の要約です。");
    assert.ok(r.result!.lines.includes("✓ 要約: 8 字"), r.result!.lines.join("\n"));
    assert.ok(r.result!.lines.some((l) => l.startsWith("⚠ カテゴリ: 「見本のカテゴリ」は入れていません")));
    assert.equal(r.scope, "");
    const text = await page.evaluate((res) => (globalThis as any).__result(res).text, r.result);
    assert.match(text, /カテゴリ・外部公開の範囲は入れていません/);
    assert.doesNotMatch(text, /要約・カテゴリ/);
  });

  it("外部公開の範囲・読了目安時間を、front matter のとおりに合わせる。結果に、入れていない欄として出さない", async () => {
    const r = await run({ ...ARTICLE, publishScope: "public", readingTime: true });
    assert.equal(r.scope, "publishScope_public");
    assert.equal(r.readingTime, true);
    assert.ok(r.result!.lines.includes("✓ 外部公開の範囲: 全文公開"), r.result!.lines.join("\n"));
    assert.ok(r.result!.lines.includes("✓ 読了目安時間: 表示する"), r.result!.lines.join("\n"));
    const text = await page.evaluate((res) => (globalThis as any).__result(res).text, r.result);
    assert.match(text, /要約・カテゴリは入れていません/);
    // 合っていれば押さない(冒頭のみ公開に合わせ直し、読了目安時間は表示しないのまま)
    const r2 = await run({ ...ARTICLE, publishScope: "limited", readingTime: true });
    assert.equal(r2.scope, "publishScope_limited");
    assert.equal(r2.readingTime, true, "合っているのに切り替えてしまいました");
    const r3 = await run({ ...ARTICLE, readingTime: false });
    assert.equal(r3.readingTime, false);
    assert.equal(r3.scope, "publishScope_limited", "外部公開が無いのに触りました");
  });

  it("要約が欄の上限より長ければ、入れずに ✗ を出す", async () => {
    const r = await run({ ...ARTICLE, summary: "あ".repeat(141) });
    assert.equal(r.summary, "");
    assert.ok(r.result!.lines.some((l) => l.startsWith("✗ 要約: 要約が 141 字で、欄の上限(140 字)を超えています")), r.result!.lines.join("\n"));
  });

  it("絵文字を含む要約は、欄の上限と同じ数え方(UTF-16)で比べる", async () => {
    const r = await run({ ...ARTICLE, summary: "あ".repeat(130) + "😀".repeat(6) });
    assert.equal(r.summary, "");
    assert.ok(r.result!.lines.some((l) => l.startsWith("✗ 要約: 要約が 136 字で、欄の上限(140 字)を超えています")), r.result!.lines.join("\n"));
  });

  it("いったん入ったタグが一度だけ消えたら、入れ直して ⚠ で知らせる", async () => {
    await page.evaluate(() => ((window as any).__tagVanish = true));
    const r = await run(ARTICLE);
    assert.deepEqual(r.tags, ["一つめ", "二つめ"]);
    assert.ok(
      r.result!.lines.some((l) => l === "⚠ タグ: 2 個。一度目は残らなかったので入れ直しました(一つめ, 二つめ。タグのボタンだけが消えていました)。画面で確かめてください"),
      r.result!.lines.join("\n"),
    );
  });

  it("タグの欄ごと作り直されたときも入れ直し、消え方を知らせる", async () => {
    await page.evaluate(() => ((window as any).__tagRebuild = true));
    const r = await run(ARTICLE);
    assert.deepEqual(r.tags, ["一つめ", "二つめ"]);
    assert.ok(r.result!.lines.some((l) => l.includes("タグの欄ごと作り直されていました")), r.result!.lines.join("\n"));
  });

  it("入れ直しても消えるなら ✗ で知らせる。タグは最後に入れる", async () => {
    await page.evaluate(() => ((window as any).__tagVanishAlways = true));
    const r = await run(ARTICLE);
    assert.deepEqual(r.tags, []);
    const tagLine = r.result!.lines.findIndex((l) => l.startsWith("✗ タグ:"));
    assert.ok(
      r.result!.lines[tagLine]?.startsWith("✗ タグ: 1 個も残っていません。入れ直しても残りませんでした。いったん入ったあと、画面から消えたタグがあります(一つめ, 二つめ。タグのボタンだけが消えていました)"),
      r.result!.lines.join("\n"),
    );
    // 記事の設定のうち、タグがいちばん後(読了目安時間よりも後)
    assert.ok(r.result!.lines.slice(tagLine + 1).every((l) => !/^[✓✗] /.test(l)), r.result!.lines.join("\n"));
  });

  it("タグが入らなかったら、候補の並びに同じ文字があっても、入ったとは数えない", async () => {
    await page.evaluate(() => ((window as any).__tagBroken = true));
    const r = await run(ARTICLE);
    // 公認タグ(一つめ)は候補のボタンで入る。打って入れる二つめは、Enter で欄が空になるだけで入らない
    assert.deepEqual(r.tags, ["一つめ"]);
    assert.ok(r.result!.lines.some((l) => l.startsWith("✗ タグ: 1 個は入れました。入れ直しても残りませんでした。入ったか確かめられなかったタグがあります(二つめ)")), r.result!.lines.join("\n"));
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
            tagSuggest: [".article_tag_suggest"],
            tagSuggestItem: [".article_tag_suggest_item"],
            tagItem: [".article_tag_inputArea .tagItems"],
            summary: ["#summary"],
          },
        },
      );
      assert.deepEqual(r.clicks, [], sel);
      assert.equal(r.result!.ok, false);
      assert.ok(r.result!.lines.some((l) => l.startsWith("✗ 記事の設定を開く") && l.includes("押しません")), r.result!.lines.join("\n"));
    }
  });

  it("キャプションは入れず、入れていないことを知らせる", async () => {
    const r = await run({
      ...ARTICLE,
      images: [{ ...ARTICLE.images[0], caption: "見本のキャプション" }],
      html: `<p>［画像1・ab12: a.png］</p>`,
    });
    assert.deepEqual(r.bodyImages, ["a.png"]);
    const line = r.result!.lines.find((l) => l.includes("本文の画像"));
    assert.match(line ?? "", /^⚠ 本文の画像: 1 枚は入れました。キャプションは入れていません\(a\.png/);
  });

  it("アップロードを待ちきれなかったら、それより後の画像は入れず、後の画像の目印も消さない", async () => {
    const r = await run({
      ...ARTICLE,
      html: `<p>［画像1・ab12: slow.png］</p><p>［画像2・ab12: c.png］</p>`,
      images: [
        { marker: "［画像1・ab12: slow.png］", name: "slow.png", mimeType: "image/png", base64: B64 },
        { marker: "［画像2・ab12: c.png］", name: "c.png", mimeType: "image/png", base64: B64 },
      ],
    });
    const line = r.result!.lines.find((l) => l.includes("本文の画像"));
    assert.match(line ?? "", /^✗ 本文の画像: .*それより後の画像は入れていません.*slow\.png, c\.png/);
    assert.match(r.body, /［画像2・ab12: c\.png］/);
    assert.ok(!r.bodyImages.includes("c.png"));
    // 遅れて入った画像があっても、後の画像の目印は残る
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => document.querySelector("[data-lexical-editor]")!.textContent);
    assert.match(after ?? "", /［画像2・ab12: c\.png］/);
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
