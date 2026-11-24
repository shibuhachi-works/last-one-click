// 追加の対応先(library.libecity.com)のページで動く content script。
// ポップアップで許可されたときだけ、chrome.scripting.registerContentScripts で登録する(manifest の content_scripts には書かない)。
// 開発用のビルド(EXTRA_SITE=1 npm run build)でだけ登録される(shared/extra-site.ts の EXTRA_SITE_ENABLED)。
// 下書きの入力はまだ無い(別の Issue で足す)。今は、ポップアップの「DOM 情報を取得」に診断のレポートを返すだけ(#118)。
// 読むだけ: ボタンを押さない、入力しない
import { buildExtraSiteReport } from "./lib/diagnose-extra-site";
import type { DiagnoseResponse, Message } from "./lib/types";

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse: (r: DiagnoseResponse) => void) => {
  if (msg?.type !== "diagnose") return;
  try {
    sendResponse({ ok: true, report: buildExtraSiteReport() });
  } catch (e) {
    sendResponse({ ok: false, error: (e as Error).message });
  }
});
