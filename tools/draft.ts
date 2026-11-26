// GitHub の記事の URL を受け取り、Chrome 拡張「Last One Click」を読み込んだブラウザで note の下書きを作る。
// note の画面に入れるのは拡張(extension/src/content.ts)で、このスクリプトは拡張を動かすだけ(#178)。
// 拡張に機能を足せば、ここでも同じように使える。公開は人間が押す。
//
//   npm run draft -- https://github.com/you/last-one-click/tree/main/posts/2026-10-28-xxx
//
// URL は、記事のフォルダ(tree)・article.md(blob)・raw・PR(…/pull/123)のどれでもよい(拡張の「GitHub から読み込む」と同じ)。
//
// 引数なし: タイトル・本文・見出し画像から公開設定(ハッシュタグ・マガジン・有料と価格・有料ライン)まで入れて止まる。
//   ブラウザで確かめて「投稿する」を自分で押し、ブラウザを閉じると終わる。
// --save(見張り役 tools/watch.ts から): タイトル・本文・見出し画像を入れて「下書き保存」を押し、ブラウザを閉じて終わる。
//   公開設定(ハッシュタグ・マガジン)は入れない(公開設定の画面を閉じると note 側で消えるため)。
// --hold(見張り役から): 下書き保存のあと、拡張のバナーの「公開設定を入れる」で公開設定まで入れて、窓を開いたまま待つ。
//   人がリモートデスクトップなどで確かめて「投稿する」を自分で押し、窓を閉じると終わる。
//
// 終わりのコード: 0 うまくいった / 1 失敗 / 2 note にログインしていない / 3 note のメンテナンス中(見張り役が見分ける)
//
// スクリプト名が publish だと npm 自身の publish コマンド(レジストリへの公開)と
// ぶつかって動かないので draft にしている。
//
// 押すのは、拡張のポップアップのボタン・「下書き保存」・拡張のバナーの「公開設定を入れる」だけ。どれも safeClick を通し、
// 「投稿する」「公開する」などは押さない(note の画面の中で押すのは拡張で、拡張も自分の safeClick を通す)。
import type { Locator, Page } from "playwright";
import { collectClickLabels } from "../shared/click-labels.js";
import { assertClickAllowed } from "../shared/forbidden-click.js";
import { STORAGE } from "../extension/src/lib/types.js";
import {
  bannerButton,
  bannerFailed,
  buildExtension,
  clearSelectorsCache,
  launchWithExtension,
  openPopup,
  overrideExtensionStorage,
  readBanner,
  saveDraft,
  submitFromPopup,
  waitBannerDone,
  type BannerResult,
} from "./lib/extension.js";
import { notify } from "./lib/notify.js";
import { NOTE } from "./lib/selectors.js";

/** 拡張が入れ終わるまで待つ長さ(本文の画像のアップロードを待つことがあるので長め) */
const FILL_TIMEOUT_MS = 10 * 60 * 1000;

const args = process.argv.slice(2);
/** 人を待たずに、下書き保存までして終わる */
const SAVE = args.includes("--save");
/** 下書き保存 → 公開設定まで入れて、人が窓を閉じるまで待つ */
const HOLD = args.includes("--hold");
if (SAVE && HOLD) {
  console.error("--save と --hold は、どちらか一方だけを付けてください。");
  process.exit(1);
}
const input = args.find((a) => !a.startsWith("--"));
if (!input) {
  console.error("使い方: npm run draft -- [--save | --hold] <GitHub の記事の URL(フォルダ・article.md・PR)>");
  process.exit(1);
}

console.log("拡張をビルドしています...");
try {
  buildExtension();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const { ctx, extensionId } = await launchWithExtension();
/** 拡張の設定を元に戻す(変えたあとで決まる。戻したら空にする) */
let restoreStorage: (() => Promise<void>) | null = null;
async function restore(): Promise<void> {
  const r = restoreStorage;
  restoreStorage = null;
  await r?.().catch(() => {});
}
/** 失敗で終わる(拡張の設定を戻し、ブラウザは閉じる) */
async function fail(message: string, code = 1): Promise<never> {
  console.error(message);
  await restore();
  await ctx.close().catch(() => {});
  process.exit(code);
}

// ---------------------------------------------------------------------------
// 1. 拡張のポップアップに記事を読み込み、下書きを作るボタンを押す

const popup = await openPopup(ctx, extensionId);
// この実行のあいだだけ、拡張の設定を変える(note のタブの拡張が入れ終わってから戻す。それまでは note のタブの拡張も同じ設定を読む):
// - 「GitHub から読み込む」を出す(上級者向けの表示)
// - 引数なしのときは、本文の確認を飛ばして公開設定まで進む(人が最後に確かめる)。--save / --hold は本文のところで止める
// - 最後のクレジット(「Last One Click で下書きしました」と #LastOneClick)は、LOC_CREDIT_LINK=1 のときだけ入れる
//   (Playwright 版は今まで入れていなかったので、黙って記事の内容を変えないように)
// - GitHub トークン(環境変数 GITHUB_TOKEN)は、非公開のリポジトリの記事を読むときに使い、終わったら消す
// - セレクタの取得先は既定の URL にする(.profile/ の拡張で別の URL を設定していても、手元の selectors/note.json を使うため。
//   tools/lib/extension.ts の route は既定の URL を差し替える)
restoreStorage = await overrideExtensionStorage(popup, {
  [STORAGE.advancedMode]: true,
  [STORAGE.skipBodyReview]: !SAVE && !HOLD,
  [STORAGE.creditLink]: process.env.LOC_CREDIT_LINK === "1",
  [STORAGE.githubToken]: process.env.GITHUB_TOKEN || undefined,
  [STORAGE.selectorsUrl]: undefined,
});
// セレクタのキャッシュは消すだけで、戻さない。拡張はこのあと手元の selectors/note.json を読んでキャッシュし直し、
// note のタブの拡張もそれを使う(戻すと、note のタブが前の実行のキャッシュを読むことがある。tools/lib/extension.ts の route)
await clearSelectorsCache(popup);
let editor: Page;
try {
  await popup.reload();
  editor = await submitFromPopup(popup, input, safeClick);
} catch (e) {
  await fail((e as Error).message);
}

// ---------------------------------------------------------------------------
// 2. note の画面で、拡張が入れ終わるのを待つ

await editor!.waitForLoadState("domcontentloaded").catch(() => {});
if (NOTE.loginUrlPattern.test(editor!.url())) {
  // 見張り役が「ログインが切れた」と分かるように、ほかの失敗と分ける
  await fail("ログインしていません。先に `npm run login` を実行してください。", 2);
}
// note のメンテナンス中は、エディタの代わりにお知らせのページが出て、タイトル欄が見つからない。
// セレクタのずれと見分けるため、タイトル欄が出ないときだけページの文字を見て、メンテナンスなら分けて終わる
// (見張り役は終了コード 3 を見て、通知を出さずに次の回でやり直す)
if (!(await editor!.locator(NOTE.title).first().waitFor({ timeout: 20_000 }).then(() => true, () => false))) {
  if (NOTE.loginUrlPattern.test(editor!.url())) await fail("ログインしていません。先に `npm run login` を実行してください。", 2);
  if (await isMaintenance(editor!)) {
    await fail("note はメンテナンス中のようです(エディタが開かず、ページに「メンテナンス」と出ています)。終わってからやり直してください。", 3);
  }
  await fail(`note のエディタのタイトル欄が見つかりません(${editor!.url()})。selectors/note.json の title を確かめてください。`);
}

console.log("拡張が note に入れています...");
let result: BannerResult;
try {
  result = await waitBannerDone(editor!, FILL_TIMEOUT_MS);
} catch (e) {
  await fail((e as Error).message);
}
printBanner(result!);
// note のタブの拡張がセレクタを読み、入れ終えたので、拡張の設定を戻す(--hold の公開設定は、読んだセレクタのまま進む)
await restore();
await popup.close().catch(() => {});

if (SAVE || HOLD) {
  // 入れる途中で失敗した工程があれば、保存せずに失敗で終わる(見張り役が知らせて、次の回でやり直す)
  if (bannerFailed(result!)) await fail("拡張の入力で失敗した工程があるので、下書き保存はしていません。");
  try {
    await saveDraft(editor!, safeClick);
  } catch (e) {
    await fail((e as Error).message);
  }
  if (SAVE) {
    console.log(`\n✅ 下書きを保存しました: ${editor!.url()}`);
    console.log("   note の「下書き」から開いて確かめ、ハッシュタグ・マガジンを入れて、自分で公開してください。");
    await ctx.close();
    process.exit(0);
  }
  // --hold: 拡張のバナーの「公開設定を入れる」を押して、公開設定まで入れる
  try {
    const before = (await readBanner(editor!))?.text;
    await safeClick(await bannerButton(editor!, "公開設定を入れる"), "draft.publishSettings");
    const published = await waitBannerDone(editor!, FILL_TIMEOUT_MS, before);
    printBanner(published);
    // 拡張は失敗した工程を記録して先へ進むので、バナーの ✗ を見て失敗にする(今までどおり、見張り役が「保存したが途中で止まった」と知らせる)
    if (bannerFailed(published)) throw new Error("拡張の公開設定で失敗した工程があります(上のバナーの ✗)。");
  } catch (e) {
    // 下書きは保存済み。見張り役が「保存したが途中で止まった」と知らせる
    await fail(`公開設定を入れられませんでした: ${(e as Error).message}`);
  }
  console.log("\n✅ 公開の手前まで入れて、待っています(下書きは保存済み)。");
  console.log("   画面で確かめて、問題なければ自分で「投稿する」を押し、窓を閉じてください。");
  // 人が窓(タブ)かブラウザを閉じるまで待つ。時間の上限は付けない。
  // 通知(Webhook は最大 10 秒かかる)の間に閉じられても取り逃さないよう、通知の前に待ち受けを始める
  const closed = waitClosed(editor!);
  const title = await editor!.locator(NOTE.title).first().inputValue().catch(() => "");
  await notify("下書きが完了しました", `${title}。確かめて「投稿する」を押し、窓を閉じてください。`, { done: { title } });
  await closed;
  await ctx.close().catch(() => {});
  console.log("窓が閉じられたので終わります。");
  process.exit(0);
}

console.log("\n✅ 拡張が入れ終わりました。");
console.log("   ブラウザで内容を確かめ、問題なければ自分で「投稿する」を押してください。");
console.log("   ブラウザ(または note のタブ)を閉じると、このスクリプトも終わります。\n");
await waitClosed(editor!);
await ctx.close().catch(() => {});

// ---------------------------------------------------------------------------

/** バナーの結果を、ターミナルにも出す */
function printBanner(r: BannerResult) {
  const mark = r.state === "error" ? "✗" : bannerFailed(r) || r.state === "warn" ? "⚠️" : "✓";
  console.log(`\n${mark} 拡張のバナー:\n${r.text.replace(/^/gm, "  ")}`);
}

/** タブかブラウザが閉じられるまで待つ */
function waitClosed(page: Page): Promise<void> {
  return new Promise<void>((resolve) => {
    if (page.isClosed()) return resolve();
    page.once("close", () => resolve());
    ctx.once("close", () => resolve());
  });
}

async function isMaintenance(page: Page): Promise<boolean> {
  const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  return /メンテナンス|maintenance/i.test(text);
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
