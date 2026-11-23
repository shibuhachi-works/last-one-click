// service worker。役割は 3 つだけ。
//   1. content script に「あなたのタブ ID」を教える(content script は chrome.tabs を使えない)
//   2. content script の代わりに selectors/note.json を読む。content script は note.com の origin で動くので、
//      同梱の selectors.json(chrome-extension://)も raw.githubusercontent.com も自分では fetch できない
//   3. 追加の対応先(library.libecity.com)の content script の登録を、許可のあるなしに合わせる
//      (起動したとき、Chrome の画面から許可を変えられたとき。ブラウザを再起動しても続けて使えるように)
// 記事の中身には触らない。
import { syncExtraSite } from "../../shared/extra-site";
import { chromeExtraSiteApi } from "./lib/extra-site";
import { loadSelectors } from "./lib/selectors";
import type { Message, SelectorsResponse, WhoAmIResponse } from "./lib/types";

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse: (r: WhoAmIResponse | SelectorsResponse) => void) => {
  if (msg?.type === "whoami") {
    sendResponse({ tabId: sender.tab?.id ?? null });
    return;
  }
  if (msg?.type === "selectors") {
    loadSelectors()
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: (e as Error).message }));
    return true; // 非同期で sendResponse する
  }
});

const syncExtraSiteScript = () => {
  syncExtraSite(chromeExtraSiteApi).catch((e) => console.warn("追加の対応先の登録を合わせられませんでした", e));
};
syncExtraSiteScript();
chrome.runtime.onStartup.addListener(syncExtraSiteScript);
chrome.permissions.onAdded.addListener(syncExtraSiteScript);
chrome.permissions.onRemoved.addListener(syncExtraSiteScript);
