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
import { htmlToText } from "../shared/markdown-safe.js";
import { loadArticle, type Article } from "./lib/article.js";
import { launchPersistent } from "./lib/browser.js";
import { notify } from "./lib/notify.js";
import { NOTE } from "./lib/selectors.js";

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
  notify("公開の手前で待っています", `${article.title}。確かめて「投稿する」を押し、窓を閉じてください。`);
  // 人が窓(タブ)かブラウザを閉じるまで待つ。時間の上限は付けない
  await new Promise<void>((resolve) => {
    page.once("close", () => resolve());
    ctx.once("close", () => resolve());
  });
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

async function setThumbnail(page: Page, a: Article) {
  if (!a.thumbnail) return;
  const file = { name: a.thumbnail.name, mimeType: a.thumbnail.mimeType, buffer: a.thumbnail.buffer };
  const input = page.locator(NOTE.thumbnail.fileInput).first();

  if (await input.count()) {
    await input.setInputFiles(file);
  } else {
    // 見出し画像のボタンを押すと、メニュー(「画像をアップロード」)が開く。画像の入力欄はメニューを開いたときだけ
    // DOM に現れる(拡張の content.ts と同じ実機の観察)。入力欄が出ればそこへ直接入れ、出なければメニューを押して
    // 開いたファイル選択へ渡す
    await safeClick(page.locator(NOTE.thumbnail.addButton).first(), "setThumbnail.addButton");
    // 実機のメニュー項目は「画像をアップロード」と「推奨サイズ: …」が 1 つの要素に入っていて、完全一致では見つからない
    // (拡張の content.ts の findSmallestByText と同じ観察)。文字を含む要素を探す(getByText は含む中でいちばん内側を返す)。
    // 記事本文(入力欄)に同じ文字があっても押さないよう、入力欄の中は除く
    const outsideEditor = page.locator('body *:not([contenteditable="true"] *):not([contenteditable="true"]):not(textarea)');
    const menu = NOTE.thumbnail.uploadMenuTexts
      .map((t) => page.getByText(t))
      .reduce((a, b) => a.or(b))
      .and(outsideEditor)
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

  // トリミング確認(ダイアログ)の確定ボタンだけを押す。画面全体から「保存」を探すと「下書き保存」を押しかねないので、
  // ダイアログの中だけを探す。画像の読み込みに時間がかかるので、出るまで待ち、少し置いてから押す
  const dialog = page.locator(NOTE.dialog).first();
  const confirm = dialog.locator(NOTE.thumbnail.confirm).first();
  // isVisible は待たないので、waitFor で出るまで待つ
  if (await confirm.waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false)) {
    await dialog.locator("img, canvas").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    await safeClick(confirm, "setThumbnail.confirm");
    // 保存のあとはアップロードが走る。ダイアログが閉じるまで待ってから次へ進む
    await dialog.waitFor({ state: "hidden", timeout: 60_000 });
    await page.waitForTimeout(1_500);
  }
}

async function fillPublishSettings(page: Page, a: Article) {
  await safeClick(page.locator(NOTE.openPublishSettings).first(), "fillPublishSettings.open");

  const tagInput = page.locator(NOTE.publishSettings.hashtagInput).first();
  await tagInput.waitFor({ timeout: 15_000 });
  for (const tag of a.hashtags) {
    await tagInput.fill(tag);
    await tagInput.press("Enter");
  }

  if (a.magazine) {
    const toggle = page.locator(NOTE.publishSettings.magazineToggle).first();
    if (await toggle.isVisible({ timeout: 2_000 }).catch(() => false)) await safeClick(toggle, "fillPublishSettings.magazineToggle");
    await safeClick(page.locator(NOTE.publishSettings.magazineItem(a.magazine)).first(), "fillPublishSettings.magazineItem");
  }

  // 公開ボタンは「存在することの確認」だけ。絶対にクリックしない。
  await page.locator(NOTE.publishSettings.publishButton).first().waitFor({ timeout: 10_000 });
}

/** ページにメンテナンスのお知らせが出ているか(タイトル欄が見つからないときだけ呼ぶ) */
async function isMaintenance(page: Page): Promise<boolean> {
  const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  return /メンテナンス|maintenance/i.test(text);
}

/** 「下書き保存」を押して、保存が終わるのを待つ。押すのはこのボタンだけ(公開ボタンには触らない) */
async function saveDraft(page: Page) {
  const button = page.locator(NOTE.saveDraft).first();
  await button.waitFor({ timeout: 15_000 });
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
