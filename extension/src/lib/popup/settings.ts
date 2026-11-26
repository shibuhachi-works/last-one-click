// 記事の設定・上級者向けの表示・診断のコピーの表示(popup.ts から分けた。動きは変えていない)。
import { articleOptionsLabel } from "../../../../shared/article-options";
import { $ } from "./dom";
import { state } from "./state";
import { markdownEl, markdownBoxEl, skipReviewEl, insertTocEl, advancedToggle } from "./elements";

// 「記事の設定」はたたんでおき、見出しの横にオンになっているものを出す
export function showArticleOptions() {
  $("article-options-on").textContent = articleOptionsLabel({
    toc: insertTocEl.checked,
    skipReview: skipReviewEl.checked,
  });
}

export function applyAdvanced(on: boolean) {
  advancedToggle.checked = on;
  $("advanced-github").hidden = !on;
  // 閉じたままだと見落とすので、上級者向けを表示しているときは「GitHub から読み込む」を開いておく
  $<HTMLDetailsElement>("github-fold").open = on;
  $("advanced-settings").hidden = !on;
  // 上級者向けでは textarea を編集(貼り付け)できる。普段はファイルの中身の確認用
  markdownEl.readOnly = !on;
  markdownBoxEl.hidden = !on && !markdownEl.value;
  // 上級者向けでは貼り付けに使うので、「読み込んだ md を見る」を開いておく。普段はたたむ(確認のためだけの欄なので)
  $<HTMLDetailsElement>("markdown-fold").open = on;
  $("markdown-note").textContent = on ? "(編集・貼り付け可)" : "(確認用)";
}

/**
 * コピーできたことを、「コピー」ボタンの上でも見せる(案内の文は、診断のボタンのすぐ下に出る)。
 * 少したつと元の「コピー」に戻す
 */
export function showCopied() {
  const button = $<HTMLButtonElement>("diagnose-copy");
  clearTimeout(state.copiedTimer);
  button.textContent = "コピーしました ✓";
  button.classList.add("copied");
  state.copiedTimer = setTimeout(() => {
    button.textContent = "コピー";
    button.classList.remove("copied");
  }, 2000);
}
