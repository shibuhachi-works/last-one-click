// service worker。役割は 4 つだけ。
//   1. content script に「あなたのタブ ID」を教える(content script は chrome.tabs を使えない)
//   2. content script の代わりに selectors/note.json を読む。content script は note.com の origin で動くので、
//      同梱の selectors.json(chrome-extension://)も raw.githubusercontent.com も自分では fetch できない
//   3. 追加の対応先(library.libecity.com)の content script の登録を、許可のあるなしに合わせる
//      (起動したとき、Chrome の画面から許可を変えられたとき。ブラウザを再起動しても続けて使えるように)
//   4. ポップアップを開いたとき、note のタブが無ければ(またはタブから返事が無ければ)、ログイン中のアカウントを
//      note.com に 1 回だけ問い合わせる(#127)。GET だけ。Cookie は読まない(ブラウザが付ける)。
//      読んだ名前・ID・アイコンの URL はポップアップに返すだけで、保存しない・note.com 以外へ送らない
//   5. 追加の対応先: ポップアップに頼まれたら、新しいタブで新規記事のエディタを開き、開いたらそのタブに記事を渡す
//      (note と同じく、別のページからも作れるように。タブを開くとポップアップは閉じるので、ここで待つ)
// 記事の中身には触らない。
import { fetchCurrentUser } from "../../shared/current-user";
import { EXTRA_SITE_ENABLED, EXTRA_SITE_HOST, EXTRA_SITE_NEW_ARTICLE_URL, fillProbe, isExtraSiteUrl, syncExtraSite, waitForNewEditor } from "../../shared/extra-site";
import { chromeExtraSiteApi } from "./lib/extra-site";
import { loadSelectors } from "./lib/selectors";
import type { AccountResponse, ExtraSiteFillResponse, Message, SelectorsResponse, WhoAmIResponse } from "./lib/types";

/** 問い合わせ先が "/" で始まるときに付ける origin(note のタブが無いので、note.com に付ける) */
const NOTE_ORIGIN = "https://note.com";

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse: (r: WhoAmIResponse | SelectorsResponse | AccountResponse | ExtraSiteFillResponse) => void) => {
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
  // 追加の対応先の新規記事を開いて入れる(開発用のビルドだけ)。ポップアップからだけ受ける。
  // タブを開いたら、すぐに返す(タブがアクティブになるとポップアップは閉じる。続きはそのページのバナーに出る)
  if (msg?.type === "extraSiteOpenAndFill" && fromExtensionPage(sender)) {
    if (!EXTRA_SITE_ENABLED) {
      sendResponse({ ok: false, error: "このビルドでは使えません。" });
      return;
    }
    sendResponse({ ok: true });
    openAndFillExtraSite(msg.article, msg.notes).catch((e) => console.warn("新規記事に入れられませんでした", e));
    return;
  }
  if (msg?.type === "account" && fromExtensionPage(sender)) {
    loadSelectors()
      .then(({ selectors }) => fetchCurrentUser(selectors.account, NOTE_ORIGIN))
      .catch(() => null)
      .then((account) => sendResponse({ account }));
    return true;
  }
});

/** 拡張のページ(ポップアップ)から来たメッセージか */
function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(""));
}

/**
 * 新しいタブで新規記事のエディタを開き、編集画面に移って欄が出たら、そのタブに記事を渡す。
 * ログインしていないときは、ログインの画面などを経てから編集画面に移るので、途中のページでは止まらずに待つ
 * (そのページが追加の対応先なら「ログインすると、そのまま入れます」と知らせる)。
 * 待ちきれなかったときは、そのタブに知らせを出す(ポップアップは閉じているので)
 */
async function openAndFillExtraSite(article: Extract<Message, { type: "extraSiteOpenAndFill" }>["article"], notes: string[]) {
  const tab = await chrome.tabs.create({ url: EXTRA_SITE_NEW_ARTICLE_URL, active: true });
  const tabId = tab.id;
  if (tabId === undefined) return;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  try {
    await waitForNewEditor(tabId, {
      tab: async (id) => {
        const t = await chrome.tabs.get(id).catch(() => null);
        return t ? { url: t.url, loading: t.status === "loading" } : null;
      },
      probe: (id) => chromeExtraSiteApi.probe(id, fillProbe()),
      sleep,
      now: () => Date.now(),
      // 追加の対応先のページなら、content script に知らせを出してもらう。ほかのサイト(ログインの画面など)には出せない
      onWaitingPage: (url) => {
        if (!isExtraSiteUrl(url)) return;
        void sendToTab(tabId, {
          type: "extraSiteNotice",
          text: `新規記事のエディタが開くのを待っています。${EXTRA_SITE_HOST} にログインすると、編集画面に移ったところで、そのまま下書きを入れます(最大 10 分待ちます)。`,
          // info だと「操作せずにお待ちください」が出る。ここはログインの操作をしてもらうので warn にする
          kind: "warn",
        }, 6);
      },
    });
  } catch (e) {
    await sendToTab(tabId, { type: "extraSiteNotice", text: `エラー: ${(e as Error).message}`, kind: "error" });
    return;
  }
  // content script は読み込みが終わってから入る。返事があるまで少し待って送り直す
  const res = await sendToTab(tabId, { type: "extraSiteFill", article, notes });
  if (res && !res.ok) await sendToTab(tabId, { type: "extraSiteNotice", text: `エラー: ${res.error}`, kind: "error" });
}

/** タブの content script にメッセージを送る。返事が無ければ 0.5 秒ごとに送り直す(既定で最大 10 秒) */
async function sendToTab(tabId: number, message: Message, tries = 20): Promise<ExtraSiteFillResponse | null> {
  for (let i = 0; i < tries; i++) {
    const res = (await chrome.tabs.sendMessage(tabId, message).catch(() => null)) as ExtraSiteFillResponse | null;
    if (res) return res;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

const syncExtraSiteScript = () => {
  syncExtraSite(chromeExtraSiteApi).catch((e) => console.warn("追加の対応先の登録を合わせられませんでした", e));
};
// 実機で下書きの入力を確かめるまでは、ふつうのビルドでは登録しない(EXTRA_SITE_ENABLED。shared/extra-site.ts)
if (EXTRA_SITE_ENABLED) {
  syncExtraSiteScript();
  chrome.runtime.onStartup.addListener(syncExtraSiteScript);
  chrome.permissions.onAdded.addListener(syncExtraSiteScript);
  chrome.permissions.onRemoved.addListener(syncExtraSiteScript);
}
