// ポップアップの画面の要素と、決まった値(popup.ts から分けた。動きは変えていない)。
import { $ } from "./dom";

/**
 * 「note の下書きを作成」ボタンの名前。案内の文には、この関数でボタンの文字をそのまま入れる
 * (ボタンの名前を変えたときに、案内の文だけ古い名前のまま残らないように。shared/popup-labels.test.ts でも確かめる)
 */
export const submitLabel = () => $("submit").textContent?.trim() || "note の下書きを作成";

// 別ウィンドウ表示。ツールバーのポップアップは Finder 等に切り替えた瞬間に閉じるので、
// ドラッグ＆ドロップで渡したいときは独立したウィンドウ(popup.html?window=1)で開く。
// 入力途中の状態(md・上書き欄とその編集状態・画像・state.baseUrl)は chrome.storage.session 経由で新しいウィンドウに引き継ぐ
export const isWindow = new URLSearchParams(location.search).has("window");

/** storage.session の上限(10 MB)に収めるため、画像はこのサイズまで引き継ぐ */
export const HANDOFF_IMAGE_MAX_BYTES = 6 * 1024 * 1024;

export const markdownEl = $<HTMLTextAreaElement>("markdown");

export const titleEl = $<HTMLInputElement>("title");

export const hashtagsEl = $<HTMLInputElement>("hashtags");

export const magazineEl = $<HTMLInputElement>("magazine");

export const priceEl = $<HTMLInputElement>("price");

export const thumbnailEl = $<HTMLInputElement>("thumbnail");

export const githubUrlEl = $<HTMLInputElement>("github-url");

export const markdownFileEl = $<HTMLInputElement>("markdown-file");

export const markdownBoxEl = $<HTMLDivElement>("markdown-box");

export const submitEl = $<HTMLButtonElement>("submit");

export const skipReviewEl = $<HTMLInputElement>("skip-review");

export const insertTocEl = $<HTMLInputElement>("insert-toc");

export const creditLinkEl = $<HTMLInputElement>("credit-link");

// 追加の対応先(library.libecity.com)。そのサイトのページ(エディタ以外でも)を開いてツールバーのアイコンを押した人にだけ案内を出し、
// 「使えるようにする」を押したときに任意の権限を求める。許可が無い人(note だけを使う人)には何も出さない
export const extraSiteOfferEl = $<HTMLDivElement>("extra-site-offer");

export const extraSiteRowEl = $<HTMLLabelElement>("extra-site-row");

export const extraSiteToggleEl = $<HTMLInputElement>("extra-site-toggle");

export const noteSubmitText = submitEl.textContent ?? "";

export const REWRITE_SUBMIT_LABEL = "この記事を書き換える";

export const submitNewEl = $<HTMLButtonElement>("submit-new");

export const submitHintEl = $("submit-hint");

export const noteSubmitHint = submitHintEl.innerHTML;

/**
 * note にだけある設定(目次・埋め込み・マガジン・価格・最後のクレジット・本文の確認を飛ばして公開設定まで進む)。
 * 入れる先が追加の対応先の編集画面のときは押せなくし、「(このページでは使えません)」を添える。チェックや欄の値は変えない
 */
// 「本文の確認を飛ばして、公開設定まで進む」は、note の本文と公開設定が別の画面だからある設定。
// 追加の対応先は記事の設定も 1 回で入れて止まるので、使わない(値も渡していない)
export const NOTE_ONLY_CONTROLS = [insertTocEl, creditLinkEl, magazineEl, priceEl, skipReviewEl];

export const UNAVAILABLE_NOTE = "(このページでは使えません)";

export const advancedToggle = $<HTMLInputElement>("advanced-toggle");

// GitHub から md を読み込んで textarea に入れる。
// PR の URL(…/pull/123)なら、その PR で変わった article.md を探し、最新のコミットの中身を読む(#172)。
// 記事が 2 本以上なら、選ぶ欄を出して選んでもらう
export const githubPickEl = $("github-pick");

export const githubArticleEl = $<HTMLSelectElement>("github-article");

// 手元の md ファイルを読み込む(ファイル選択、または textarea へのドロップ)。
// 相対パスの thumbnail はブラウザからは辿れないので、見出し画像はポップアップで選んでもらう
export const MAX_MD_BYTES = 2 * 1024 * 1024;

/**
 * md の front matter(と先頭の # 見出し)から、note に入れるタイトル・ハッシュタグ・マガジン・価格を欄に出す。
 * 欄は普段は隠していて、md を読み込んだときだけ出す。送るのは欄の値(ここで直せる)
 */
export const fieldsEl = $<HTMLDivElement>("fields");

export const fieldsEditEl = $<HTMLDetailsElement>("fields-edit");
