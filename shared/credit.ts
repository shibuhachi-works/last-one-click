// 拡張で作る下書きの本文の最後に、区切り線と「この記事は、Last One Click で下書きしました。」の 1 行を足す(#35)。
// 同じチェックで、ハッシュタグ #LastOneClick も足す。チェックは既定で入っていて、外せば入らない
// (たたんだ中に隠さず、ポップアップのチェックの文言に、リンクとハッシュタグの両方が入ることを書いてある)。
// ツールが入れた事実の表示にとどめるため、文言は変えない(「便利」「おすすめ」などの宣伝の言葉は足さない)。
//
// 本文の md の最後に足すと、記事の書き方に左右される(Codex の指摘):
// - 記事の最後が閉じていないコードブロックだと、足した行がコードの中に入る
// - front matter が無く先頭が --- の記事だと、足した --- を front matter の終わりと読み違え、本文が消える
// そこで、md を HTML に変換したあとに、独立した要素として足す。
// 足す HTML は、下の CREDIT_MARKDOWN を marked(SAFE_RENDERER)で変換したものと同じ(テストで確かめる)。

/** Chrome ウェブストアの Last One Click のページ(README の「Chrome ウェブストアで入手」と同じ) */
export const CREDIT_URL = "https://chromewebstore.google.com/detail/last-one-click/jomapffkhcdpnodaffobmpfofnnaihnd";

/** 足すものを md で書いたもの(区切り線 + 1 行)。HTML の CREDIT_HTML と同じ中身 */
export const CREDIT_MARKDOWN = `---\n\nこの記事は、[Last One Click](${CREDIT_URL}) で下書きしました。\n`;

/** 本文の HTML の最後に足すもの */
export const CREDIT_HTML = `<hr>\n<p>この記事は、<a href="${CREDIT_URL}">Last One Click</a> で下書きしました。</p>\n`;

/** チェックを入れたときに足すハッシュタグ(# は付けない。ほかのハッシュタグと同じ持ち方) */
export const CREDIT_HASHTAG = "LastOneClick";

/** enabled のとき、ハッシュタグの最後に LastOneClick を足す。すでにあれば(大文字・小文字・# の違いは同じとみなす)足さない */
export function withCreditHashtag(hashtags: string[], enabled: boolean): string[] {
  if (!enabled) return hashtags;
  const has = hashtags.some((t) => t.replace(/^#/, "").toLowerCase() === CREDIT_HASHTAG.toLowerCase());
  return has ? hashtags : [...hashtags, CREDIT_HASHTAG];
}

/** enabled のとき、本文の HTML の最後に区切り線と 1 行を足す。enabled でなければ html をそのまま返す */
export function appendCreditHtml(html: string, enabled: boolean): string {
  if (!enabled) return html;
  return `${html.replace(/\s+$/, "")}\n${CREDIT_HTML}`;
}
