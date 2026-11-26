// note の「タイトル、本文を入力してください」のお知らせを探す。ブラウザの中で動く(DOM 依存、import なし)。
// 実機では、下書き保存のすぐあとに「公開に進む」を押すと、タイトルと本文が入っているのにこれが出ることがある
// (閉じて、少し待ってから押し直すと開く)。拡張の公開設定の工程が、閉じて押し直すのに使う(#178 で Playwright 版から移した)。
// DOM テストからは page.evaluate でページ側に送って実行するので、外の変数を参照しない・内側に名前付きの関数を作らない。

/**
 * お知らせを含むいちばん内側の、見えている要素と、そのお知らせを閉じるボタン(お知らせを含むいちばん内側の箱の中の「閉じる」)。
 * 記事の入力欄(本文・タイトル)の中の文字は見ない(記事に同じ文があっても取り違えないため)。無ければ alert は null
 */
export function findEmptyAlert(): { alert: HTMLElement | null; close: HTMLElement | null } {
  const re = /タイトル.{0,3}本文.{0,3}入力してください/;
  const hits = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter(
    (el) =>
      !el.closest('[contenteditable="true"], textarea, input') &&
      el.offsetParent !== null &&
      re.test(el.textContent ?? "") &&
      !Array.from(el.children).some((c) => re.test(c.textContent ?? "")),
  );
  const alert = hits[0] ?? null;
  if (!alert) return { alert: null, close: null };
  let box: HTMLElement | null = alert;
  while (box && !box.querySelector("button")) box = box.parentElement;
  const close = box
    ? (Array.from(box.querySelectorAll<HTMLElement>("button")).find((b) => (b.textContent ?? "").replace(/\s+/g, "") === "閉じる") ?? null)
    : null;
  return { alert, close };
}
