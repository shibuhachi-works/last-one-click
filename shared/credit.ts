// 拡張で作る下書きの本文の最後に、区切り線と「この記事は、Last One Click で下書きしました。」の 1 行を足す(#35)。
// ツールが入れた事実の表示にとどめるため、文言は変えない(「便利」「おすすめ」などの宣伝の言葉は足さない)。
// HTML に変換する前の md の最後に足すので、記事に書いた `---` や `[文字](URL)` と同じ経路で note に入る。

/** Chrome ウェブストアの Last One Click のページ(README の「Chrome ウェブストアで入手」と同じ) */
export const CREDIT_URL = "https://chromewebstore.google.com/detail/last-one-click/jomapffkhcdpnodaffobmpfofnnaihnd";

/** 本文の最後に足す md(区切り線 + 1 行) */
export const CREDIT_MARKDOWN = `---\n\nこの記事は、[Last One Click](${CREDIT_URL}) で下書きしました。\n`;

/**
 * enabled のとき、本文の最後に区切り線と 1 行を足す。enabled でなければ md をそのまま返す。
 * 最後の改行の有無にかかわらず、区切り線が直前の段落とつながらないよう、空行を 1 つはさむ
 * (空行が無いと `---` が直前の行の見出しの印として読まれる)
 */
export function appendCredit(markdown: string, enabled: boolean): string {
  if (!enabled) return markdown;
  return `${markdown.replace(/\s+$/, "")}\n\n${CREDIT_MARKDOWN}`;
}
