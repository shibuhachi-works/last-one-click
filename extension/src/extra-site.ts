// 追加の対応先(library.libecity.com)のページで動く content script。
// ポップアップで許可されたときだけ、chrome.scripting.registerContentScripts で登録する(manifest の content_scripts には書かない)。
// 開発用のビルド(EXTRA_SITE=1 npm run build)でだけ登録される(shared/extra-site.ts の EXTRA_SITE_ENABLED)。
// 受けるのは 2 つ:
//   1. ポップアップの「DOM 情報を取得」に、診断のレポートを返す(読むだけ。#118)
//   2. ポップアップの「このページに下書きを入れる」で、このタブの編集画面に記事を入れて止まる(#120。./lib/extra-site-fill.ts)。
//      「確認画面へ」「下書き保存」は押さない
import { isExtraSiteUrl } from "../../shared/extra-site";
import { buildExtraSiteReport } from "./lib/diagnose-extra-site";
import { fillExtraSite, resultMessage, showBanner } from "./lib/extra-site-fill";
import type { DiagnoseResponse, ExtraSiteFillResponse, Message } from "./lib/types";

/** 入れている途中か(二重に押されたときに、重ねて入れない) */
let filling = false;

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse: (r: DiagnoseResponse | ExtraSiteFillResponse) => void) => {
  if (msg?.type === "diagnose") {
    try {
      sendResponse({ ok: true, report: buildExtraSiteReport() });
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message });
    }
    return;
  }
  if (msg?.type === "extraSiteFill") {
    if (!isExtraSiteUrl(location.href)) {
      sendResponse({ ok: false, error: "このページには入れられません。" });
      return;
    }
    if (filling) {
      sendResponse({ ok: false, error: "このページには、いま入れている途中です。終わるまで待ってください。" });
      return;
    }
    filling = true;
    // 入れ終わるのは待たずに返す(ポップアップは閉じてよい)。結果はページのバナーに出す
    sendResponse({ ok: true });
    showBanner("下書きを入れています…");
    fillExtraSite(msg.article, msg.notes)
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
