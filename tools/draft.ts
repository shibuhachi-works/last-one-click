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

  const direct = page.locator(NOTE.thumbnail.fileInput).first();
  if (await direct.count()) {
    await direct.setInputFiles(file);
  } else {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 10_000 }),
      safeClick(page.locator(NOTE.thumbnail.addButton).first(), "setThumbnail.addButton"),
    ]);
    await chooser.setFiles(file);
  }

  // トリミング確認(ダイアログ)が出るなら、その中の確定ボタンだけを押す。
  // 画面全体から「保存」を探すと「下書き保存」を押しかねないので、ダイアログが無ければ何もしない
  const confirm = page.locator(NOTE.dialog).locator(NOTE.thumbnail.confirm).first();
  if (await confirm.isVisible({ timeout: 3_000 }).catch(() => false)) await safeClick(confirm, "setThumbnail.confirm");
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
