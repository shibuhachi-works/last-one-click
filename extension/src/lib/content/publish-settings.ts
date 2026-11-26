// 公開設定の画面で入れる工程: ハッシュタグ・マガジン・有料・価格・有料ライン(content.ts から分けた。動きは変えていない)。「投稿する」は押さない。
import { findMagazineRowButton } from "../../../../shared/magazine-row";
import { findPaidControls } from "../../../../shared/paid-price";
import { findEmptyAlert } from "../../../../shared/empty-alert";
import { findPaywallTarget, paywallFailureMessage, type PaywallTarget } from "../../../../shared/paywall";
import { safeClick } from "../safe-click";
import { type ArticlePayload, type Selectors } from "../types";
import { waitFor, waitUntil, findByText, isToggledOn, isSelected, setNativeValue, sleep } from "./dom";

export async function fillPublishSettings(S: Selectors, a: ArticlePayload) {
  // 公開設定がまだ開いていなければ「公開に進む」を押す(「もう一度入れる」を公開設定の画面で押した場合は開いている)。
  // 実機では、下書き保存のすぐあとに押すと、タイトルと本文が入っているのに「タイトル、本文を入力してください」が出ることがある
  // (閉じて押し直すと開く)。そのときは閉じて、待ってから押し直す(3 回まで。#178 で Playwright 版から移した)
  for (let attempt = 1; !document.querySelector(S.publishSettings.hashtagInput); attempt++) {
    const open = findByText("button", S.openPublishSettingsText);
    if (!open) throw new Error("「公開に進む」ボタンが見つかりません。");
    safeClick(open, "fillPublishSettings.open");
    const result = await waitUntil(
      () => (document.querySelector(S.publishSettings.hashtagInput) ? "open" : findEmptyAlert().alert ? "empty" : null),
      10_000,
    );
    if (result !== "empty") break;
    if (attempt >= 3) throw new Error("「公開に進む」を 3 回押しましたが、note が「タイトル、本文を入力してください」と出して進めませんでした。");
    const { alert, close } = findEmptyAlert();
    if (close) safeClick(close, "fillPublishSettings.closeEmptyAlert");
    else (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await waitUntil(() => (alert?.isConnected && alert.offsetParent !== null ? null : true), 5_000);
    await sleep(3_000 * attempt);
  }

  const tagInput = await waitFor<HTMLInputElement>(S.publishSettings.hashtagInput, 10_000);
  for (const tag of a.hashtags) {
    tagInput.focus();
    setNativeValue(tagInput, tag);
    tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    tagInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
    await sleep(200);
  }

  // 公開ボタンは「あるかどうか」を見るだけ。絶対にクリックしない。
  // 「有料」を選んであると(「もう一度入れる」で入れ直したとき)、公開ボタンの代わりに「有料エリア設定」が出る。これも見るだけで押さない
  if (!findByText("button", S.publishSettings.publishButtonText) && !findByText("button", S.publishSettings.paidAreaButtonText)) {
    throw new Error("公開ボタンが見つかりません(画面構成が変わった可能性)。");
  }
}

/**
 * 公開設定の記事タイプで「有料」を選び、価格の欄に入れる。「有料」を選ぶと出る「有料エリア設定」は押さない
 * (有料エリアの境目は人が note の画面で決める)
 */
export async function setPaidPrice(S: Selectors, price: number, withPaywall = false) {
  const P = S.publishSettings;
  const found = findPaidControls(P.paidRadio, P.paidLabelText, P.priceInput);
  // 「もう一度入れる」で再実行したときに、選択済みのものを押し直さない
  if (!found.checked) {
    if (!found.label) throw new Error("記事タイプの「有料」が見つかりません。\n画面で「有料」を選んで、価格を手で入れてください。");
    safeClick(found.label, "fillPublishSettings.paid");
  }
  const input = await waitFor<HTMLInputElement>(P.priceInput, 5_000).catch(() => null);
  if (!input) throw new Error("価格の欄が見つかりません。\n画面で価格を手で入れてください。");
  const value = String(price);
  input.focus();
  setNativeValue(input, value);
  input.blur();
  if (input.value !== value) throw new Error(`価格の欄に ${value} を入れられませんでした。\n画面で価格を手で入れてください。`);
  return withPaywall ? `${value} 円` : `${value} 円。有料エリアは「有料エリア設定」で自分で決めてください`;
}

/**
 * 「有料エリア設定」を押し、本文の「ここから有料」の印の直前のブロック(anchor)と同じ文字のブロックのすぐ下の
 * 「ラインをこの場所に変更」を押す。何番目のボタンかでは決めない。一致が無い・2 つ以上なら押さずに失敗にする。
 * ラインが動いたことを確かめてから成功にする。その先の「投稿する」などは押さない
 */
export async function setPaywallLine(S: Selectors, anchor: string) {
  const P = S.publishSettings;
  const find = (): PaywallTarget => findPaywallTarget(P.paywallContainer, P.paywallWidget, P.paywallChangeButtonText, P.paywallLine, anchor);
  // 「もう一度入れる」で再実行したときは、もう有料エリア設定の画面が開いている
  if (!document.querySelector(P.paywallContainer)) {
    const open = findByText("button", P.paidAreaButtonText);
    if (!open) throw new Error("「有料エリア設定」のボタンが見つかりません。\n画面で「有料エリア設定」を押し、手でラインを引いてください。");
    safeClick(open, "setPaywallLine.open");
  }
  // 画面が組み立てられるまで(ブロックとボタンが並ぶまで)待つ
  let target = await waitUntil(() => {
    const t = find();
    return t.status === "ok" || t.status === "already" ? t : null;
  }, 10_000);
  if (!target) throw new Error(paywallFailureMessage(find()));
  if (target.status === "ok" && target.button) {
    safeClick(target.button, "setPaywallLine.line");
    target = await waitUntil(() => (find().status === "already" ? find() : null), 5_000);
    if (!target) throw new Error("「ラインをこの場所に変更」を押しましたが、ラインが動いたことを確かめられませんでした。\n画面でラインの位置を確かめ、違っていれば手でラインを引いてください。");
  }
  return "印の直前の段落のすぐ下にラインを引きました。位置を画面で確かめてください";
}

/** 公開設定の画面でマガジンを選ぶ。名前が一致する行が無ければ、直し方を添えて失敗にする */
export async function selectMagazine(S: Selectors, magazine: string) {
  // 「マガジン」の切り替えは、まだオンでないときだけ押す(実機では最初からオン。押すとオフになって一覧が消える)
  const toggle = findByText("button", S.publishSettings.magazineToggleText);
  if (toggle && !isToggledOn(toggle)) {
    safeClick(toggle, "fillPublishSettings.magazineToggle");
    await sleep(300);
  }
  // (1) label / option 形式(名前そのものを押す)
  const item = Array.from(document.querySelectorAll<HTMLElement>(S.publishSettings.magazineItem)).find(
    (el) => el.textContent?.trim() === magazine,
  );
  if (item) {
    // 「もう一度入れる」で再実行したときに、選択済みのものを押して外さない
    if (!isSelected(item)) safeClick(item, "fillPublishSettings.magazineItem");
    return;
  }
  // (2) 実機の形式: マガジン名の行に「追加」ボタンがある。名前の行の中だけを見る(別の行の「追加」は押さない)
  const row = findMagazineRowButton(magazine, S.publishSettings.magazineAddButtonText);
  if (!row.rowFound) {
    throw new Error(
      `マガジン「${magazine}」が note にありません。\nmd の magazine と note のマガジン名が同じか確かめてください。\n(画面で手で選ぶか、md を直して作り直してください)`,
    );
  }
  if (row.button) {
    if (!isToggledOn(row.button)) safeClick(row.button, "fillPublishSettings.magazineAdd");
    return;
  }
  return `「追加」が無いので押していません(追加済みの可能性)`;
}

// ---------------------------------------------------------------------------
// ユーティリティ
