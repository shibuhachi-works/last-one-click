// 公開設定の「記事タイプ」で「有料」を選ぶための部品を探す。ブラウザの中で動く(DOM 依存、import なし)。
// 拡張の content script からはそのまま呼び、Playwright 版や DOM テストからは page.evaluate で
// ページ側に送って実行する。そのため、この関数は外の変数を参照してはいけない。
//
// 実機(2026-11-16 の診断レポート): 記事タイプは隠れたラジオ input#free / input#paid(name="is_paid")で、
// 押すのは文字が「無料」「有料」の label。「有料」を選ぶと価格の欄 input#price が出て、
// 右上のボタンが「有料エリア設定」になる(このボタンは押さない。有料エリアは人が決める)。
// ここは探すだけで、押すのは呼び出し側(safeClick を通す)。

export type PaidControls = {
  /** 「有料」の label。文字が paidLabelTexts と違うものは返さない(selectors が別の部品を指していても押さないため) */
  label: HTMLElement | null;
  /** すでに「有料」を選んであるか */
  checked: boolean;
  /** 価格の欄。「有料」を選ぶまでは無い */
  priceInput: HTMLInputElement | null;
};

export function findPaidControls(paidRadio: string, paidLabelTexts: readonly string[], priceInput: string): PaidControls {
  // 注: 内側に名前付き関数を作らない(tsx/esbuild の keepNames が __name を挿入し、ページ側に送ると未定義になる)
  const texts = paidLabelTexts.map((t) => t.replace(/\s+/g, "")).filter(Boolean);
  const radio = document.querySelector<HTMLInputElement>(paidRadio);
  // ラジオに付いた label を先に使い、無ければ文字が「有料」の label を探す(ボタンの中のものは除く)
  let label: HTMLElement | null = (radio?.labels && radio.labels[0]) || radio?.closest("label") || null;
  if (!label) {
    label =
      Array.from(document.querySelectorAll<HTMLElement>("label")).find(
        (l) => texts.includes((l.textContent ?? "").replace(/\s+/g, "")) && !l.closest("button"),
      ) ?? null;
  }
  if (label && !texts.includes((label.textContent ?? "").replace(/\s+/g, ""))) label = null;
  const control = label instanceof HTMLLabelElement ? label.control : null;
  const input = radio ?? (control instanceof HTMLInputElement ? control : null) ?? label?.querySelector<HTMLInputElement>('input[type="radio"]') ?? null;
  return {
    label,
    checked: Boolean(input?.checked),
    priceInput: document.querySelector<HTMLInputElement>(priceInput),
  };
}
