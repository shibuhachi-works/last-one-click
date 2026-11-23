// ポップアップを開いたときに出す、ログイン中の note アカウント(#106 / #127)を、どこに聞くか決める。
//
// - note のタブがあれば、今どおりそのタブ(content script)に聞く。タブが答えたら(読めなかった null も含めて)それで終わり
// - note のタブが無いとき、またはタブから返事が無いとき(content script がまだ居ない等)だけ、拡張(service worker)に聞く
// - どちらに聞いても、問い合わせは 1 回だけ。定期的には聞かない
// - 読んだ名前・ID・アイコンの URL は返すだけ。ここでは保存しない
import type { CurrentUser } from "./current-user";

/** note のタブ・service worker からの返事。返事が無ければ null */
export type AccountReply = { account: CurrentUser | null } | null;

export type PopupAccountDeps = {
  /** note のタブの ID。無ければ undefined */
  findNoteTab: () => Promise<number | undefined>;
  /** そのタブの content script に聞く。返事が無ければ null */
  askTab: (tabId: number) => Promise<AccountReply>;
  /** service worker に聞く(service worker が note.com に 1 回問い合わせる)。返事が無ければ null */
  askBackground: () => Promise<AccountReply>;
};

/** 画面に出してよい形か(名前が文字で、空でない) */
function usable(a: CurrentUser | null | undefined): CurrentUser | null {
  return a && typeof a.name === "string" && a.name ? a : null;
}

/** 返事として読める形か(account を持つオブジェクト) */
function isReply(r: unknown): r is { account: CurrentUser | null } {
  return !!r && typeof r === "object" && "account" in r;
}

/** ログイン中のアカウントを 1 回だけ聞く。読めなければ null。投げない */
export async function loadPopupAccount(deps: PopupAccountDeps): Promise<CurrentUser | null> {
  const tabId = await deps.findNoteTab().catch(() => undefined);
  if (tabId !== undefined) {
    const res = await deps.askTab(tabId).catch(() => null);
    if (isReply(res)) return usable(res.account);
  }
  const res = await deps.askBackground().catch(() => null);
  return isReply(res) ? usable(res.account) : null;
}
