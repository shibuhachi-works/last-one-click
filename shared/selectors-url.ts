// 設定の「selectors/note.json の URL」の欄に入れられた値を、保存する前に確かめる。
// 記事の URL をこの欄に入れてしまう間違いが起きたので、記事の欄(「GitHub から読み込む」)へ案内する。
// 空は「既定値を使う」なので通す。

export const SELECTORS_URL_ARTICLE_MESSAGE =
  "この欄は、note の画面の定義ファイル(selectors の .json)の URL です。記事の URL は、上の「GitHub から読み込む」に貼ってください。";

/** 問題がなければ null、あれば利用者に見せる文言を返す */
export function checkSelectorsUrl(input: string): string | null {
  const value = input.trim();
  if (value === "") return null;

  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return "URL の形になっていません。空にすると既定値を使います。";
  }
  if (u.protocol !== "https:") return "https:// で始まる URL を入れてください。空にすると既定値を使います。";

  const path = u.pathname.toLowerCase();
  if (!path.endsWith(".json")) return SELECTORS_URL_ARTICLE_MESSAGE;
  if (u.hostname === "github.com") {
    return "github.com のページの URL では読めません。raw.githubusercontent.com の URL(GitHub の画面の「Raw」を開いたときの URL)を入れてください。";
  }
  return null;
}
