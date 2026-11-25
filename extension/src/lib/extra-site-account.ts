// 追加の対応先のページに出ている、ログイン中のアカウント(名前・アイコン)を読む。
// - ページに出ているものを読むだけ。追加の対応先に問い合わせはしない。Cookie も読まない
// - アイコンはヘッダーの右上(編集画面にもある)。名前はマイページの左の欄などにだけある(編集画面には無い)
// - 読んだものはポップアップに返すだけ。保存しない
import { extraSiteSelectors, type ExtraSiteAccount, type ExtraSiteSelectors } from "../../../shared/extra-site";

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
