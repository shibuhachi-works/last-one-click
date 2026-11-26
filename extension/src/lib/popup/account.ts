// ログイン中のアカウントと、記事の指定(note_account)の表示。診断の相手のタブ探し(popup.ts から分けた。動きは変えていない)。
import { parse as parseYaml } from "yaml";
import { sameNoteAccount } from "../../../../shared/note-account";
import { parseFrontMatter } from "../../../../shared/article";
import { EXTRA_SITE_ENABLED, EXTRA_SITE_HOST, EXTRA_SITE_ORIGIN, isExtraSiteUrl, pickExtraSiteTab } from "../../../../shared/extra-site";
import { loadPopupAccount } from "../../../../shared/popup-account";
import { type AccountResponse, type ExtraSiteAccountResponse, type Message } from "../types";
import { $, accountRow } from "./dom";
import { state } from "./state";
import { isWindow, extraSiteOfferEl, extraSiteRowEl, extraSiteToggleEl } from "./elements";
import { destination, applyDestination } from "./destination";

/**
 * 追加の対応先のログイン中のアカウントを、「(ドメイン): [アイコン] 名前」と出す。
 * 開いている追加の対応先のタブ(今のタブを先に。無ければ最近見たタブ)の content script に 1 回だけ聞く。
 * 名前はマイページの左の欄にだけあるので、開いているページに無ければ、そのタブがマイページを 1 回だけ GET で読む
 * (extension/src/lib/extra-site-account.ts)。タブが無いか読めなければ何も出さない。読んだものは保存しない
 */
export async function showExtraSiteAccount(): Promise<void> {
  if (!EXTRA_SITE_ENABLED || state.extraSiteAccountAsked) return;
  state.extraSiteAccountAsked = true;
  const [current] = isWindow ? [] : await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const tabs = await chrome.tabs.query({ url: EXTRA_SITE_ORIGIN }).catch(() => []);
  const tabId = pickExtraSiteTab(current, tabs);
  if (tabId === undefined) return;
  const res = (await chrome.tabs.sendMessage(tabId, { type: "extraSiteAccount" } satisfies Message).catch(() => null)) as ExtraSiteAccountResponse | null;
  const account = res?.account;
  // 読んでいるあいだに許可を外していたら出さない
  if (!account || (!account.name && !account.iconUrl) || !state.extraSiteGranted) return;
  const el = $<HTMLParagraphElement>("extra-site-account");
  el.replaceChildren(...accountRow(EXTRA_SITE_HOST, account.iconUrl, account.name));
  el.title = `${EXTRA_SITE_HOST} でログイン中のアカウントです。`;
  state.extraSiteAccountShown = true;
  applyDestination();
}

export function showExtraSiteSetting(granted: boolean) {
  state.extraSiteGranted = granted;
  if (granted) void showExtraSiteAccount();
  else {
    // 許可を外したら、そのサイトのアカウントも出さない(読んだものは捨てる。付け直したら読み直す)
    state.extraSiteAccountShown = false;
    state.extraSiteAccountAsked = false;
    $("extra-site-account").replaceChildren();
  }
  applyDestination();
  extraSiteRowEl.hidden = !granted;
  extraSiteToggleEl.checked = granted;
  if (granted) extraSiteOfferEl.hidden = true;
}

/**
 * 診断の相手にする追加の対応先のタブ。開発用のビルドで、ツールバーのポップアップの今のタブがそのページのときだけ。
 * (独立したウィンドウでは今のタブ = この画面なので、見ない)
 */
export async function findExtraSiteTab(): Promise<chrome.tabs.Tab | undefined> {
  if (!EXTRA_SITE_ENABLED || isWindow) return undefined;
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  return current?.id !== undefined && isExtraSiteUrl(current.url) ? current : undefined;
}

/** 診断の相手にする note のタブ。アクティブなものを優先し、無ければ最後に見たもの(URL の照合は host_permissions の範囲) */
export async function findNoteTab(): Promise<chrome.tabs.Tab | undefined> {
  const NOTE = ["https://note.com/*", "https://editor.note.com/*"];
  // ツールバーのポップアップなら、今のウィンドウでアクティブな note のタブ(= 見ているエディタ)
  const [current] = await chrome.tabs.query({ url: NOTE, active: true, currentWindow: true });
  if (current) return current;
  // 独立ウィンドウなどで該当しなければ、最後に見た note のタブ
  const tabs = await chrome.tabs.query({ url: NOTE });
  return tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

/**
 * ログイン中の note アカウントを、「note の下書きを作成」の近くに出す(#106)。
 * 開いている note のタブがあれば、そのタブの content script に 1 回だけ聞く。
 * タブが無いとき(またはタブから返事が無いとき)だけ、service worker が note.com に 1 回問い合わせる(#127)。
 * 拡張は Cookie を読まない(ログインの状態はブラウザが付ける)。
 * 読めなければ何も出さない。名前・ID・アイコンの URL は画面に出すだけで、保存しない
 */
export async function showAccount(): Promise<void> {
  const account = await loadPopupAccount({
    findNoteTab: async () => (await findNoteTab())?.id,
    askTab: (tabId) => chrome.tabs.sendMessage(tabId, { type: "account" } satisfies Message) as Promise<AccountResponse | null>,
    askBackground: () => chrome.runtime.sendMessage({ type: "account" } satisfies Message) as Promise<AccountResponse | null>,
  });
  if (!account) return;
  state.loggedInAccount = account;
  renderAccountTarget();
  const el = $<HTMLParagraphElement>("account");
  el.replaceChildren(...accountRow("note.com", account.iconUrl, account.name, account.id && account.id !== account.name ? `(@${account.id})` : undefined));
  el.title = "note でログイン中のアカウントです。";
  // 入れる先のサイトのアカウントだけを出す(読み終わる前に入れる先が決まっていることがあるので、ここでも合わせる。#191)
  el.hidden = destination() === "extra-site";
}

/** md の front matter の note_account。無いか読めなければ undefined */
export function readNoteAccount(md: string): string | undefined {
  try {
    return parseFrontMatter(md, parseYaml).data.noteAccount;
  } catch {
    return undefined;
  }
}

/**
 * 記事が note_account を指定していれば、「記事の指定: ◯◯」を「note の下書きを作成」の近くに出す(#102)。
 * ログイン中のアカウントが読めていて違うときは、注意に変える。ボタンは押せるままにする(止めるかどうかは、
 * note のタブの content script が工程を始める前に比べて決める)
 */
export function renderAccountTarget(): void {
  const el = $<HTMLParagraphElement>("account-target");
  const want = state.articleNoteAccount;
  const id = state.loggedInAccount?.id;
  const mismatch = Boolean(want && id && !sameNoteAccount(id, want));
  el.hidden = !want || destination() === "extra-site";
  el.classList.toggle("mismatch", mismatch);
  el.textContent = !want
    ? ""
    : mismatch
      ? `⚠️ ログイン中のアカウント(${id})が、記事の設定(${want})と違います。`
      : `記事の設定: ${want}`;
}
