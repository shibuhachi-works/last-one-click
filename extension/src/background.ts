// service worker。役割は 4 つだけ。
//   1. content script に「あなたのタブ ID」を教える(content script は chrome.tabs を使えない)
//   2. content script の代わりに selectors/note.json を読む。content script は note.com の origin で動くので、
//      同梱の selectors.json(chrome-extension://)も raw.githubusercontent.com も自分では fetch できない
//   3. 追加の対応先(library.libecity.com)の content script の登録を、許可のあるなしに合わせる
//      (起動したとき、Chrome の画面から許可を変えられたとき。ブラウザを再起動しても続けて使えるように)
//   4. ポップアップを開いたとき、note のタブが無ければ(またはタブから返事が無ければ)、ログイン中のアカウントを
//      note.com に 1 回だけ問い合わせる(#127)。GET だけ。Cookie は読まない(ブラウザが付ける)。
//      読んだ名前・ID・アイコンの URL はポップアップに返すだけで、保存しない・note.com 以外へ送らない
// 記事の中身には触らない。
import { fetchCurrentUser } from "../../shared/current-user";
import { syncExtraSite } from "../../shared/extra-site";
import { chromeExtraSiteApi } from "./lib/extra-site";
import { loadSelectors } from "./lib/selectors";
import type { AccountResponse, Message, SelectorsResponse, WhoAmIResponse } from "./lib/types";

/** 問い合わせ先が "/" で始まるときに付ける origin(note のタブが無いので、note.com に付ける) */
const NOTE_ORIGIN = "https://note.com";

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse: (r: WhoAmIResponse | SelectorsResponse | AccountResponse) => void) => {
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
  // 拡張のページ(ポップアップ。独立したウィンドウ・タブで開いたときも)からだけ受ける。
  // content script(note のページ)からは受けない(タブの中で自分で問い合わせる)
  if (msg?.type === "account" && sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(""))) {
    loadSelectors()
      .then(({ selectors }) => fetchCurrentUser(selectors.account, NOTE_ORIGIN))
      .catch(() => null)
      .then((account) => sendResponse({ account }));
    return true;
  }
});

const syncExtraSiteScript = () => {
  syncExtraSite(chromeExtraSiteApi).catch((e) => console.warn("追加の対応先の登録を合わせられませんでした", e));
};
syncExtraSiteScript();
chrome.runtime.onStartup.addListener(syncExtraSiteScript);
chrome.permissions.onAdded.addListener(syncExtraSiteScript);
chrome.permissions.onRemoved.addListener(syncExtraSiteScript);
