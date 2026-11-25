// 追加の対応先のページに出ている、ログイン中のアカウント(名前・アイコン)を読む。
// - アイコンはヘッダーの右上(編集画面にもある)。名前はマイページの左の欄にだけある(編集画面には無い)
// - 開いているページに名前が無ければ、マイページ(通知設定)を同じサイトの中から 1 回だけ GET で読み、そこから名前を読む。
//   書き込みはしない。Cookie は読まない(ログインの状態はブラウザが付ける)
// - 読んだものはポップアップに返すだけ。保存しない
import { EXTRA_SITE_ACCOUNT_PAGE_URL, extraSiteSelectors, isExtraSiteUrl, type ExtraSiteAccount, type ExtraSiteSelectors } from "../../../shared/extra-site";

/** 名前として出す長さの上限(長すぎるものは、名前ではないものを拾ったとみなす) */
const MAX_NAME = 60;

function first(selectors: string[], root: ParentNode): Element | null {
  for (const s of selectors) {
    try {
      const el = root.querySelector(s);
      if (el) return el;
    } catch {
      // 書き方の違うセレクタは飛ばす
    }
  }
  return null;
}

/** ページからアカウントを読む。名前もアイコンも無ければ null */
export function readExtraSiteAccount(
  root: ParentNode = document,
  selectors: Pick<ExtraSiteSelectors, "accountIcon" | "accountName"> = extraSiteSelectors(),
): ExtraSiteAccount | null {
  const out: ExtraSiteAccount = {};
  const name = first(selectors.accountName, root)?.textContent?.replace(/\s+/g, " ").trim();
  if (name && name.length <= MAX_NAME) out.name = name;
  const img = first(selectors.accountIcon, root);
  const src = img instanceof HTMLImageElement ? img.currentSrc || img.src : "";
  if (src.startsWith("https://")) out.iconUrl = src;
  return out.name || out.iconUrl ? out : null;
}

export type LoadAccountDeps = {
  /** 今のページ */
  root?: ParentNode;
  selectors?: Pick<ExtraSiteSelectors, "accountIcon" | "accountName">;
  /** マイページを読む(既定は fetch)。HTML と、たどり着いた URL を返す。読めなければ null */
  fetchPage?: (url: string) => Promise<{ html: string; url: string } | null>;
};

async function fetchPage(url: string): Promise<{ html: string; url: string } | null> {
  const res = await fetch(url, { method: "GET", credentials: "same-origin", redirect: "follow" });
  if (!res.ok) return null;
  return { html: await res.text(), url: res.url || url };
}

/**
 * ログイン中のアカウントを読む。今のページに名前があればそれだけで返す。
 * 無ければマイページを 1 回だけ読み、名前(とアイコン)を足す。ログインの画面など、別のサイトに移ったときは使わない
 */
export async function loadExtraSiteAccount(deps: LoadAccountDeps = {}): Promise<ExtraSiteAccount | null> {
  const selectors = deps.selectors ?? extraSiteSelectors();
  const here = readExtraSiteAccount(deps.root ?? document, selectors);
  if (here?.name) return here;
  try {
    const page = await (deps.fetchPage ?? fetchPage)(EXTRA_SITE_ACCOUNT_PAGE_URL);
    if (!page || !isExtraSiteUrl(page.url)) return here;
    const doc = new DOMParser().parseFromString(page.html, "text/html");
    // 画像の相対の URL は、マイページの URL を元にする
    const base = doc.createElement("base");
    base.href = page.url;
    doc.head.prepend(base);
    const there = readExtraSiteAccount(doc, selectors);
    if (!there?.name) return here;
    return { name: there.name, iconUrl: here?.iconUrl ?? there.iconUrl };
  } catch {
    return here;
  }
}
