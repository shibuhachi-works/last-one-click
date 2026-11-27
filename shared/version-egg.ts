// ポップアップのいちばん下の版の文字を、続けて押したときの一言(#198)。Android の「ビルド番号を 7 回押す」にならった見た目の遊びで、
// 機能を解放したり、通信・保存したりはしない

/** 一言が出るまでに押す回数 */
export const VERSION_TAPS = 7;
/** 押す間隔がこれより空いたら、数え直す */
export const VERSION_TAP_GAP_MS = 1_500;
/** 7 回押したときの一言 */
export const VERSION_EGG_MESSAGE = "最後のワンクリックは、あなたの手で。";

/** 押した回数(count 回目)に出す文。何も出さないときは null */
export function versionTapMessage(count: number): string | null {
  if (count >= VERSION_TAPS) return VERSION_EGG_MESSAGE;
  const left = VERSION_TAPS - count;
  return left <= 3 ? `あと ${left} 回` : null;
}

/** 押した時刻から、続けて押した回数を数える(間が空いたら 1 から) */
export function nextTapCount(prev: { count: number; at: number }, now: number): number {
  return now - prev.at <= VERSION_TAP_GAP_MS ? prev.count + 1 : 1;
}
