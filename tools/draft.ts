// GitHub 上の記事ディレクトリ URL を受け取り、note の下書きを組み立てて
// 「公開ボタンの手前」で止める。公開は人間が押す。
//
//   npm run draft -- https://github.com/you/last-one-click/tree/main/posts/2026-10-28-xxx
//
// --save を付けると、人を待たずに動く(見張り役 tools/watch.ts から使う)。
// タイトル・本文・見出し画像を入れて「下書き保存」を押し、ブラウザを閉じて終わる。
// 公開設定(ハッシュタグ・マガジン)は入れない(公開設定の画面を閉じると note 側で消えるため)。
// 押すのは「下書き保存」だけで、公開ボタンには触らない。
//
// --hold を付けると、下書き保存のあと、公開設定(ハッシュタグ・マガジン)まで入れて、窓を開いたまま待つ
// (Inspector は出さない)。人がリモートデスクトップなどで確かめて「投稿する」を自分で押し、
// 窓を閉じると終わる。待つ前に下書き保存しておくので、待っている間に PC が止まっても下書きは残る。
//
// スクリプト名が publish だと npm 自身の publish コマンド(レジストリへの公開)と
// ぶつかって動かないので draft にしている。
//
// 途中でセレクタが合わなくなったら、止まった箇所の Playwright Inspector で
// 要素を Pick して tools/lib/selectors.ts を直す。
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { collectClickLabels } from "../shared/click-labels.js";
import { assertClickAllowed } from "../shared/forbidden-click.js";
import { findEyecatchButton } from "../shared/eyecatch-button.js";
import { htmlToText } from "../shared/markdown-safe.js";
import { matchesAnyText } from "../shared/text-match.js";
import { loadArticle, type Article } from "./lib/article.js";
import { launchPersistent } from "./lib/browser.js";
import { notify } from "./lib/notify.js";
import { NOTE } from "./lib/selectors.js";

/** ボタンになりうる要素(下の関数より先に置く。関数はこのファイルの上のほうの処理から呼ばれるため) */
const BUTTONS = 'button, [role="button"]';

const args = process.argv.slice(2);
/** 人を待たずに、下書き保存までして終わる */
const SAVE = args.includes("--save");
/** 下書き保存 → 公開設定まで入れて、人が窓を閉じるまで待つ */
const HOLD = args.includes("--hold");
/** 入力の途中には人がいない(失敗したら止めずに閉じる) */
const UNATTENDED = SAVE || HOLD;
if (SAVE && HOLD) {
  console.error("--save と --hold は、どちらか一方だけを付けてください。");
  process.exit(1);
}
const input = args.find((a) => !a.startsWith("--"));
if (!input) {
  console.error("使い方: npm run draft -- [--save | --hold] <GitHub の記事ディレクトリ URL>");
  process.exit(1);
}

console.log(`記事を取得中: ${input}`);
const article = await loadArticle(input);
console.log(`  title    : ${article.title}`);
console.log(`  hashtags : ${article.hashtags.join(", ") || "(なし)"}`);
console.log(`  magazine : ${article.magazine ?? "(なし)"}`);
console.log(`  thumbnail: ${article.thumbnail?.name ?? "(なし)"}`);

const ctx = await launchPersistent();
const page = await ctx.newPage();

await page.goto(NOTE.newNoteUrl);
if (NOTE.loginUrlPattern.test(page.url())) {
  console.error("ログインしていません。先に `npm run login` を実行してください。");
  await ctx.close();
  // 見張り役が「ログインが切れた」と分かるように、ほかの失敗と分ける
  process.exit(2);
}

// note のメンテナンス中は、エディタの代わりにお知らせのページが出て、タイトル欄が見つからない。
// セレクタのずれと見分けるため、タイトル欄が出ないときだけページの文字を見て、メンテナンスなら分けて終わる
// (見張り役は終了コード 3 を見て、通知を出さずに次の回でやり直す)。
// 普段のエディタにもメンテナンスの予告が出ることがあるので、タイトル欄が出たときは見ない
if (!(await page.locator(NOTE.title).first().waitFor({ timeout: 15_000 }).then(() => true, () => false))) {
  if (await isMaintenance(page)) {
    console.error("note はメンテナンス中のようです(エディタが開かず、ページに「メンテナンス」と出ています)。終わってからやり直してください。");
    await ctx.close();
    process.exit(3);
  }
}

await step("タイトル入力", () => fillTitle(page, article));
await step("本文貼り付け", () => pasteBody(page, article));
await step("サムネイル設定", () => setThumbnail(page, article));

if (SAVE) {
  await step("下書き保存", () => saveDraft(page));
  console.log(`\n✅ 下書きを保存しました: ${page.url()}`);
  console.log("   note の「下書き」から開いて確かめ、ハッシュタグ・マガジンを入れて、自分で公開してください。");
  await ctx.close();
  process.exit(0);
}
if (HOLD) {
  await step("下書き保存", () => saveDraft(page));
  await step("公開設定(タグ・マガジン)", () => fillPublishSettings(page, article));
  console.log("\n✅ 公開の手前まで入れて、待っています(下書きは保存済み)。");
  console.log("   画面で確かめて、問題なければ自分で「投稿する」を押し、窓を閉じてください。");
  // 人が窓(タブ)かブラウザを閉じるまで待つ。時間の上限は付けない。
  // 通知(Webhook は最大 10 秒かかる)の間に閉じられても取り逃さないよう、通知の前に待ち受けを始める
  const closed = new Promise<void>((resolve) => {
    if (page.isClosed()) return resolve();
    page.once("close", () => resolve());
    ctx.once("close", () => resolve());
  });
  await notify("下書きが完了しました", `${article.title}。確かめて「投稿する」を押し、窓を閉じてください。`, { done: { title: article.title } });
  await closed;
  await ctx.close().catch(() => {});
  console.log("窓が閉じられたので終わります。");
  process.exit(0);
}
await step("公開設定(タグ・マガジン)", () => fillPublishSettings(page, article));

console.log("\n✅ 公開ボタンの手前まで入力しました。");
console.log("   ブラウザで内容を確認し、問題なければ自分で公開ボタンを押してください。");
console.log("   Inspector の ▶ (Resume) を押すとスクリプトが終了し、ブラウザも閉じます。\n");
await page.pause();
await ctx.close();

// ---------------------------------------------------------------------------

async function step(name: string, fn: () => Promise<void>) {
  process.stdout.write(`- ${name} ... `);
  try {
    await fn();
    console.log("OK");
  } catch (e) {
    console.log("FAILED");
    console.error(`  ${(e as Error).message}`);
    console.error("  セレクタがずれている可能性があります。Inspector で要素を確認して selectors.ts を直してください。");
    // --save / --hold(見張り役から)は入力の途中に人がいないので、止めずに閉じて失敗で終わる
    if (UNATTENDED) {
      await ctx.close();
      process.exit(1);
    }
    await page.pause();
    throw e;
  }
}

async function fillTitle(page: Page, a: Article) {
  const el = page.locator(NOTE.title).first();
  await el.waitFor({ timeout: 15_000 });
  await safeClick(el, "fillTitle");
  await el.fill(a.title);
}

/**
 * Markdown から変換した HTML を、クリップボードから貼り付けたのと同じ経路で入れる。
 * ProseMirror 系エディタは innerHTML の直接書き換えだと内部状態と食い違うため、
 * paste イベントに text/html を載せて渡すのが一番壊れにくい。
 */
async function pasteBody(page: Page, a: Article) {
  const el = page.locator(NOTE.body).first();
  await el.waitFor({ timeout: 15_000 });
  await safeClick(el, "pasteBody");
  // text/plain は Node 側で作って渡す(以前は空の Range を渡していて空文字になっていた)
  await el.evaluate(
    (node, [html, plain]) => {
      const dt = new DataTransfer();
      dt.setData("text/html", html);
      dt.setData("text/plain", plain);
      node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    [a.html, htmlToText(a.html)] as const,
  );
  // 反映を少し待つ
  await page.waitForTimeout(500);
}

/**
 * 見出し画像のボタン。selectors の指定(aria-label・文字)で探し、無ければ拡張と同じく画面上の位置で探す
 * (実機のボタンは文字も aria-label も無いアイコンボタン。shared/eyecatch-button.ts)。
 * 位置で見つけたボタンには印の属性を付けて、Playwright の locator で押す(クリックは safeClick を通す)
 */
async function eyecatchButton(page: Page): Promise<Locator> {
  const bySelector = page.locator(NOTE.thumbnail.addButton).first();
  if (await bySelector.count()) return bySelector;
  const MARK = "data-lastclick-eyecatch";
  const found = await page
    .locator(NOTE.title)
    .first()
    .evaluate(
      (title, [fn, mark]) => {
        // 関数は文字列で送る(tsx の keepNames が入れる __name がページ側に無いため。eyecatch-button.dom.test.ts と同じ)
        const find = new Function(`return (${fn})`)() as (t: HTMLElement) => HTMLElement | null;
        const btn = find(title as HTMLElement);
        if (!btn) return false;
        btn.setAttribute(mark, "1");
        return true;
      },
      [findEyecatchButton.toString(), MARK] as const,
    );
  if (!found) throw new Error("見出し画像のボタンが見つかりません(タイトル欄の上にアイコンのボタンがありません)。");
  return page.locator(`[${MARK}="1"]`).first();
}

async function setThumbnail(page: Page, a: Article) {
  if (!a.thumbnail) return;
  // 印の名前(関数の中に置く。ファイルの上のほうの処理から呼ばれ、下の const はまだ初期化されていないため)
  /** 確定ボタンの文字に一致するボタン */
  const CONFIRM_MARK = "data-lastclick-confirm";
  /** 見出し画像を入れる前から画面にあった、確定ボタンと同じ文字のボタン */
  const BEFORE_MARK = "data-lastclick-before";
  const file = { name: a.thumbnail.name, mimeType: a.thumbnail.mimeType, buffer: a.thumbnail.buffer };
  const input = page.locator(NOTE.thumbnail.fileInput).first();
  // 画面にもとからある確定ボタンと同じ文字のボタンには印を付けておき、あとで押さない
  // 見えているものだけに付ける。トリミングの画面は前から DOM にあって隠れているだけのことがあり、隠れたものに
  // 印を付けると、その画面が出たときに確定ボタンを押せなくなる
  await markByText(page, BUTTONS, NOTE.thumbnail.confirmTexts, CONFIRM_MARK);
  await page
    .locator(`[${CONFIRM_MARK}]`)
    .filter({ visible: true })
    .evaluateAll((els, mark) => els.forEach((e) => e.setAttribute(mark, "1")), BEFORE_MARK);

  if (await input.count()) {
    await input.setInputFiles(file);
  } else {
    // 見出し画像のボタンを押すと、メニュー(「画像をアップロード」)が開く。画像の入力欄はメニューを開いたときだけ
    // DOM に現れる(拡張の content.ts と同じ実機の観察)。入力欄が出ればそこへ直接入れ、出なければメニューを押して
    // 開いたファイル選択へ渡す
    await safeClick(await eyecatchButton(page), "setThumbnail.addButton");
    // 実機のメニュー項目は「画像をアップロード」と「推奨サイズ: …」が 1 つの要素に入っていて、完全一致では見つからない
    // (拡張の content.ts の findSmallestByText と同じ観察)。文字を含む要素を探す(getByText は含む中でいちばん内側を返す)。
    // 記事本文(入力欄)に同じ文字があっても押さないよう、入力欄の中は除く

    const menu = NOTE.thumbnail.uploadMenuTexts
      .map((t) => page.getByText(t))
      .reduce((a, b) => a.or(b))
      .and(outsideEditor(page))
      .first();
    const appeared = await Promise.race([
      input.waitFor({ state: "attached", timeout: 10_000 }).then(() => "input" as const),
      menu.waitFor({ state: "visible", timeout: 10_000 }).then(() => "menu" as const),
    ]).catch(() => null);
    if (appeared === "input") {
      await input.setInputFiles(file);
    } else if (appeared === "menu") {
      const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10_000 }), safeClick(menu, "setThumbnail.uploadMenu")]);
      await chooser.setFiles(file);
    } else {
      throw new Error("見出し画像のボタンを押しましたが、メニューも画像の入力欄も出ませんでした。");
    }
  }

  // トリミングの確定ボタン(「保存」など。完全一致なので「下書き保存」は当たらない)を押す。
  // 実機のトリミングの画面は role="dialog" などの印が無いことがあるので、拡張(content.ts の waitForConfirm)と同じく、
  // 画像を入れる前から画面にあったものを除いた、見えている確定ボタンを探す。見つからなければ失敗にする
  // (確定しないまま進むと、見出し画像が入らず、画面も覆われたままになる)
  const confirm = await waitByText(page, BUTTONS, NOTE.thumbnail.confirmTexts, CONFIRM_MARK, 20_000, `:not([${BEFORE_MARK}])`);
  if (!confirm) {
    throw new Error(`見出し画像のトリミングの確定ボタン(「保存」)が出ませんでした。見えているボタン: ${await visibleButtonTexts(page)}`);
  }
  // 画像の読み込みを少し待ってから押す
  await page.waitForTimeout(1_500);
  await safeClick(confirm, "setThumbnail.confirm");
  // 保存のあとはアップロードが走る。確定ボタン(トリミングの画面)が消えるまで待ってから次へ進む
  await confirm.waitFor({ state: "hidden", timeout: 60_000 }).catch(() => {
    throw new Error("見出し画像のトリミングの画面が閉じませんでした(アップロードが遅いか失敗した可能性)。");
  });
  await page.waitForTimeout(1_500);
}

async function fillPublishSettings(page: Page, a: Article) {
  const tagInput = page.locator(NOTE.publishSettings.hashtagInput).first();
  // 実機では、下書き保存のすぐあとに「公開に進む」を押すと、タイトルと本文が入っているのに
  // 「タイトル、本文を入力してください」が出ることがある(閉じて押し直すと開く)。そのときは閉じて、待ってから押し直す
  // 記事本文(入力欄)に同じ文があっても取り違えないよう、入力欄の中は除く(見出し画像のメニューと同じ)
  const emptyAlert = page.getByText(/タイトル.{0,3}本文.{0,3}入力してください/).and(outsideEditor(page)).first();
  for (let attempt = 1; ; attempt++) {
    const open = await waitByText(page, BUTTONS, NOTE.openPublishSettingsTexts, "data-lastclick-open", 15_000);
    if (!open) throw new Error(`「公開に進む」のボタンが見つかりません。見えているボタン: ${await visibleButtonTexts(page)}`);
    await safeClick(open, "fillPublishSettings.open");
    // 公開設定の画面は、別の URL へ移ってから組み立てられるので、少し長めに待つ
    const result = await Promise.race([
      tagInput.waitFor({ timeout: 30_000 }).then(() => "open" as const, () => null),
      emptyAlert.waitFor({ timeout: 30_000 }).then(() => "empty" as const, () => null),
    ]);
    if (result === "open") break;
    if (result === "empty" && attempt < 3) {
      await closeEmptyAlert(page, emptyAlert);
      await page.waitForTimeout(3_000 * attempt);
      continue;
    }
    if (result === "empty") throw new Error("「公開に進む」を 3 回押しましたが、note が「タイトル、本文を入力してください」と出して進めませんでした。");
    // 次に直すための手がかり: いまの URL と、見えている入力欄の placeholder・aria-label
    const inputs = await page
      .locator("input, textarea, [contenteditable='true']")
      .evaluateAll((els) =>
        els
          .filter((e) => (e as HTMLElement).offsetParent !== null)
          .map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute("placeholder") ?? e.getAttribute("aria-label") ?? ""}]`)
          .slice(0, 20),
      )
      .catch(() => [] as string[]);
    throw new Error(
      `ハッシュタグの入力欄が見つかりません。URL: ${page.url()} / 見えている入力欄: ${inputs.join(", ") || "なし"} / 見えているボタン: ${await visibleButtonTexts(page)}`,
    );
  }
  for (const tag of a.hashtags) {
    await tagInput.fill(tag);
    await tagInput.press("Enter");
  }

  if (a.magazine) {
    const toggle = await waitByText(page, BUTTONS, NOTE.publishSettings.magazineToggleTexts, "data-lastclick-magazine-toggle", 2_000);
    if (toggle) await safeClick(toggle, "fillPublishSettings.magazineToggle");
    const item = await waitByText(page, NOTE.publishSettings.magazineItemBase, [a.magazine], "data-lastclick-magazine", 10_000);
    if (!item) throw new Error(`マガジン「${a.magazine}」が見つかりません。`);
    await safeClick(item, "fillPublishSettings.magazineItem");
  }

  // 公開ボタンは「存在することの確認」だけ。絶対にクリックしない(印を付けて数えるだけ)。
  if (!(await waitByText(page, BUTTONS, NOTE.publishSettings.publishButtonTexts, "data-lastclick-publish", 10_000))) {
    throw new Error(`公開設定の画面になったことを確かめられませんでした(公開のボタンが見えません)。見えているボタン: ${await visibleButtonTexts(page)}`);
  }
}

/**
 * 「タイトル、本文を入力してください」のお知らせを閉じる。押すのは、そのお知らせを含むいちばん内側の箱の中の
 * 「閉じる」だけ(エディタの上にある別の「閉じる」は押さない)。見つからなければ Escape で閉じる
 */
async function closeEmptyAlert(page: Page, alert: Locator) {
  const box = alert.locator("xpath=ancestor::*[.//button][1]");
  const close = box.locator("button").filter({ hasText: /^\s*閉じる\s*$/ }).first();
  if (await close.isVisible().catch(() => false)) await safeClick(close, "fillPublishSettings.closeEmptyAlert");
  else await page.keyboard.press("Escape");
  await alert.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
}

/** 記事の入力欄(本文・タイトル)の外にある要素。記事に同じ文字があっても、画面の部品と取り違えないため */
function outsideEditor(page: Page): Locator {
  return page.locator('body *:not([contenteditable="true"] *):not([contenteditable="true"]):not(textarea)');
}

/** ページにメンテナンスのお知らせが出ているか(タイトル欄が見つからないときだけ呼ぶ) */
async function isMaintenance(page: Page): Promise<boolean> {
  const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  return /メンテナンス|maintenance/i.test(text);
}

/**
 * base に当たる要素のうち、文字が候補に一致するものに印(属性 mark)を付ける。一致の判定は拡張と同じ
 * (shared/text-match.ts の matchesAnyText: 表示文字か aria-label を正規化して完全一致。「保存」は「下書き保存」に当たらない)。
 * Playwright の `button:text-is("…")` は、文字がボタンの中の <span> などに入っていると当たらない(実機の note のボタンはこの形)
 */
async function markByText(page: Page, base: string, texts: readonly string[], mark: string): Promise<void> {
  const all = page.locator(base);
  const labels = await all.evaluateAll((els) => els.map((e) => [e.textContent, e.getAttribute("aria-label")] as const));
  const hits = labels.flatMap((l, i) => (matchesAnyText(l, texts) ? [i] : []));
  await all.evaluateAll(
    (els, [hits, mark]) => els.forEach((e, i) => (hits.includes(i) ? e.setAttribute(mark, "1") : e.removeAttribute(mark))),
    [hits, mark] as const,
  );
}

/** base に当たり文字が候補に一致する、見えている要素が出るまで待つ(extra は追加の条件の CSS)。出なければ null */
async function waitByText(page: Page, base: string, texts: readonly string[], mark: string, timeout: number, extra = ""): Promise<Locator | null> {
  const end = Date.now() + timeout;
  for (;;) {
    await markByText(page, base, texts, mark);
    const el = page.locator(`[${mark}]${extra}`).filter({ visible: true }).first();
    if (await el.count()) return el;
    if (Date.now() > end) return null;
    await page.waitForTimeout(500);
  }
}

/** 見えているボタンの文字の一覧(見つからなかったときの手がかり。押しはしない) */
async function visibleButtonTexts(page: Page): Promise<string> {
  const texts = await page
    .locator('button, [role="button"]')
    .filter({ visible: true })
    .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim().slice(0, 20) || `(${e.getAttribute("aria-label") ?? "文字なし"})`))
    .catch(() => [] as string[]);
  return texts.slice(0, 30).join(" / ") || "なし";
}

/** 「下書き保存」を押して、保存が終わるのを待つ。押すのはこのボタンだけ(公開ボタンには触らない) */
async function saveDraft(page: Page) {
  // 拡張と同じ一致判定で探し、見えているものを押す(同じ文字のボタンが隠れて複数あることがある)
  const button = await waitByText(page, BUTTONS, ["下書き保存"], "data-lastclick-save", 15_000);
  if (!button) throw new Error(`「下書き保存」のボタンが見つかりません。見えているボタン: ${await visibleButtonTexts(page)}`);
  // 押したあとに note の API へ送られる保存の通信(GET 以外)を待ち、成功したことを確かめる。
  // 確かめられなければ失敗にする(見張り役が「保存できた」と記録して、やり直さなくなるのを防ぐ)
  const saved = page.waitForResponse((r) => r.request().method() !== "GET" && /^https:\/\/([a-z0-9-]+\.)?note\.com\/api\//.test(r.url()), {
    timeout: 15_000,
  });
  await safeClick(button, "saveDraft");
  const res = await saved.catch(() => {
    throw new Error("下書き保存の通信が 15 秒以内に返ってきませんでした。");
  });
  if (!res.ok()) throw new Error(`下書き保存に失敗しました(HTTP ${res.status()})。`);
  // 見張り役から動かしたときは、保存が済んだ印を残す(このあと止まっても、同じ記事を作り直さないため)
  const marker = process.env.LOC_SAVED_MARKER;
  if (marker) {
    mkdirSync(path.dirname(marker), { recursive: true });
    writeFileSync(marker, `${new Date().toISOString()} ${page.url()}\n`);
  }
  // 続く通信(画像など)が落ち着くのを少し待ってから閉じる
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

/**
 * クリックは必ずここを通す。要素とその親のボタンの表示文字・aria-label・value・title を集めて、
 * 「投稿する」「公開する」などに当たればクリックせずに投げる(selectors/note.json とは無関係)。
 */
async function safeClick(locator: Locator, context: string) {
  // collectClickLabels は外の変数を参照しないので、そのままページ側に送って実行できる
  const labels = await locator.evaluate(collectClickLabels);
  assertClickAllowed(labels, context);
  await locator.click();
}
