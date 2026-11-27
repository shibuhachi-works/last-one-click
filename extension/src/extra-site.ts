// 追加の対応先(library.libecity.com)のページで動く content script。
// ポップアップで許可されたときだけ、chrome.scripting.registerContentScripts で登録する(manifest の content_scripts には書かない)。
// 追加の対応先の許可があるときだけ登録される(shared/extra-site.ts)。
// 受けるのは 4 つ:
//   1. ポップアップの「DOM 情報を取得」に、診断のレポートを返す(読むだけ。#118)
//   2. ポップアップの「今開いているページに下書きを入れる」で、このタブの編集画面に記事を入れて止まる(#120。./lib/extra-site-fill.ts)。
//      「確認画面へ」「下書き保存」は押さない。新しいタブで新規記事を開いたときは、service worker が送ってくる
//   3. service worker からの知らせ(新規記事のエディタが開かなかったときなど)を、ページのバナーに出す
//   4. ポップアップに、ログイン中のアカウント(名前・アイコン)を返す(./lib/extra-site-account.ts。
//      今のページに名前が無ければ、マイページを 1 回だけ GET で読む)
import { isExtraSiteUrl } from "../../shared/extra-site";
import { buildExtraSiteReport } from "./lib/diagnose-extra-site";
import { loadExtraSiteAccount } from "./lib/extra-site-account";
import { showBanner, showBannerStatus } from "./lib/extra-site-banner";
import { fillExtraSite, resultMessage } from "./lib/extra-site-fill";
import type { DiagnoseResponse, ExtraSiteAccountResponse, ExtraSiteFillResponse, Message } from "./lib/types";

/** 入れている途中か(二重に押されたときに、重ねて入れない) */
let filling = false;

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse: (r: DiagnoseResponse | ExtraSiteFillResponse | ExtraSiteAccountResponse) => void) => {
  if (msg?.type === "extraSiteAccount") {
    // 名前が今のページに無ければマイページを 1 回読むので、返事は待ってから返す
    loadExtraSiteAccount()
      .then((account) => sendResponse({ account }))
      .catch(() => sendResponse({ account: null }));
    return true;
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
      sendResponse({ ok: false, error: "記事の編集画面ではありません。" });
      return;
    }
    if (filling) {
      sendResponse({ ok: false, error: "入力中です。終わるまでお待ちください。" });
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
