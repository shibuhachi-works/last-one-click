// 追加の対応先(library.libecity.com)のページで動く content script。
// ポップアップで許可されたときだけ、chrome.scripting.registerContentScripts で登録する(manifest の content_scripts には書かない)。
// 開発用のビルド(EXTRA_SITE=1 npm run build)でだけ登録される(shared/extra-site.ts の EXTRA_SITE_ENABLED)。
// 受けるのは 4 つ:
//   1. ポップアップの「DOM 情報を取得」に、診断のレポートを返す(読むだけ。#118)
//   2. ポップアップの「今開いているページに下書きを入れる」で、このタブの編集画面に記事を入れて止まる(#120。./lib/extra-site-fill.ts)。
//      「確認画面へ」「下書き保存」は押さない。新しいタブで新規記事を開いたときは、service worker が送ってくる
//   3. service worker からの知らせ(新規記事のエディタが開かなかったときなど)を、ページのバナーに出す
//   4. ポップアップに、ページに出ているログイン中のアカウント(名前・アイコン)を返す(読むだけ。./lib/extra-site-account.ts)
import { isExtraSiteUrl } from "../../shared/extra-site";
import { buildExtraSiteReport } from "./lib/diagnose-extra-site";
import { readExtraSiteAccount } from "./lib/extra-site-account";
import { showBanner, showBannerStatus } from "./lib/extra-site-banner";
import { fillExtraSite, resultMessage } from "./lib/extra-site-fill";
import type { DiagnoseResponse, ExtraSiteAccountResponse, ExtraSiteFillResponse, Message } from "./lib/types";

/** 入れている途中か(二重に押されたときに、重ねて入れない) */
let filling = false;

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse: (r: DiagnoseResponse | ExtraSiteFillResponse | ExtraSiteAccountResponse) => void) => {
  if (msg?.type === "extraSiteAccount") {
    try {
      sendResponse({ account: readExtraSiteAccount() });
    } catch {
      sendResponse({ account: null });
    }
    return;
  }
  if (msg?.type === "diagnose") {
    try {
      sendResponse({ ok: true, report: buildExtraSiteReport() });
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message });
    }
    return;
  }
  if (msg?.type === "extraSiteNotice") {
    // service worker からだけ受ける(ページの中のスクリプトは chrome.runtime のメッセージを送れない)
    showBanner(msg.text, msg.kind);
    sendResponse({ ok: true });
    return;
  }
  if (msg?.type === "extraSiteFill") {
    if (!isExtraSiteUrl(location.href)) {
      sendResponse({ ok: false, error: "今開いているページは記事の編集画面ではないので、入れられません。" });
      return;
    }
    if (filling) {
      sendResponse({ ok: false, error: "今開いているページには、いま下書きを入れている途中です。終わるまで待ってください。" });
      return;
    }
    filling = true;
    // 入れ終わるのは待たずに返す(ポップアップは閉じてよい)。結果はページのバナーに出す
    sendResponse({ ok: true });
    showBanner("下書きを入れています…");
    fillExtraSite(msg.article, msg.notes, { onProgress: showBannerStatus })
      .then((r) => {
        const m = resultMessage(r);
        showBanner(m.text, m.kind);
      })
      .catch((e) => showBanner(`エラー: ${(e as Error).message}`, "error"))
      .finally(() => {
        filling = false;
      });
  }
});
