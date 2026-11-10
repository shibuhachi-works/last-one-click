// 拡張の中でクリックを起こすときは必ずここを通す(AGENTS.md)。content script も popup も同じ関数を使う。
// 要素とその親のボタンの表示文字・aria-label・value・title を集めて、
// 「投稿する」「公開する」などに当たればクリックせずに投げる(selectors/note.json とは無関係)。
import { collectClickLabels } from "../../../shared/click-labels";
import { assertClickAllowed } from "../../../shared/forbidden-click";

export function safeClick(el: HTMLElement, context: string, opts: { at?: { x: number; y: number } } = {}) {
  assertClickAllowed(collectClickLabels(el), context);
  if (opts.at) {
    // 実際のクリックと同じ座標・detail を持つ click を起こす(el.click() は座標 0,0・detail 0 で、
    // 座標で当たり判定する部品や detail 0 を無視する部品には効かない)
    el.dispatchEvent(new MouseEvent("click", { ...pointerInit(opts.at), detail: 1 }));
    return;
  }
  el.click();
}

/** マウス系イベントの共通の初期値。座標は画面上の位置(clientX/Y)として載せる */
function pointerInit(at: { x: number; y: number }) {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    pointerType: "mouse",
    clientX: at.x,
    clientY: at.y,
    screenX: at.x,
    screenY: at.y,
  };
}

/**
 * マウスで「押し始める」(pointerdown → mousedown)。禁止クリックの判定は safeClick と同じ。
 * メニューの開閉を click ではなく pointerdown で行う部品(Radix 系のドロップダウンなど)向け。
 * 呼び出し側は、押し始めた結果(メニューが開いたか)を見てから release する:
 * 開いていれば click: false(click まで送ると、click でも開閉する部品では閉じてしまう)、開いていなければ click: true
 */
export function safePress(el: HTMLElement, context: string, at: { x: number; y: number }): { release: (opts: { click: boolean }) => void } {
  assertClickAllowed(collectClickLabels(el), context);
  const init = pointerInit(at);
  // 実際のマウス操作と同じく、押す前に hover のイベントも起こす(hover で中身を出す部品向け)
  el.dispatchEvent(new PointerEvent("pointerover", init));
  el.dispatchEvent(new MouseEvent("mouseover", init));
  el.dispatchEvent(new PointerEvent("pointermove", init));
  el.dispatchEvent(new MouseEvent("mousemove", init));
  el.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
  el.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
  return {
    release: ({ click }) => {
      el.dispatchEvent(new PointerEvent("pointerup", init));
      el.dispatchEvent(new MouseEvent("mouseup", init));
      if (click) safeClick(el, context, { at });
    },
  };
}

/**
 * キーボードでボタンを押す(keydown → keyup)。禁止クリックの判定は safeClick と同じ。
 * pointer / click に反応しない部品(キー操作だけ別のハンドラで開くもの)向けの最後の手段
 */
export function safeKey(el: HTMLElement, context: string, key: "Enter" | " " | "Backspace") {
  assertClickAllowed(collectClickLabels(el), context);
  const init = { key, code: key === " " ? "Space" : key, bubbles: true, cancelable: true, composed: true };
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
}
