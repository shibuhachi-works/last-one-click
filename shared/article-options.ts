// ポップアップの「記事の設定」(たたんだ所)の見出しの横に、いまオンになっているものを短く出す。
// たたんだままでも、何が入るかが分かるようにする。

export type ArticleOptions = { toc: boolean; embed: boolean; images?: boolean; credit?: boolean };

/** 例: 「(目次・埋め込み・リンク)」。全部オフなら「(なし)」 */
export function articleOptionsLabel(o: ArticleOptions): string {
  const on = [o.toc && "目次", o.embed && "埋め込み", o.images && "画像", o.credit && "リンク"].filter(Boolean);
  return `(${on.length ? on.join("・") : "なし"})`;
}
