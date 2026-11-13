// 画像のアップロードを待つ時間を測る時計(拡張の content script が使う)。
// note のダイアログ(alert。「画像アップロード中です」など)が開いているあいだは、ページの処理が止まり、拡張の処理も止まる。
// そのまま置いておくと、止まっていた時間も待ち時間に数えられ、拡張が先に「入らなかった」とみなしてしまう(2026-11-13 実機)。
// そこで、測るたびに前に測ったときからの間を見て、長く空いていたら「止まっていた」とみなし、その分は数えない。
// ただし、タブが裏にあるとき、Chrome はタイマーを間引く(最大 1 分に 1 回)ので、画面が見えているときの間だけを止まっていたとみなす
// (ダイアログは、そのタブを前に出して開く)。止まっていたとみなす時間には上限を付け、いつまでも待ち続けないようにする

/** この間より長く空いたら、止まっていたとみなす(拡張は 0.25〜1 秒ごとに測る) */
export const STALL_MS = 2_000;
/** 止まっていたとみなす時間の上限(これを超えた分は待ち時間に数える) */
export const MAX_PAUSED_MS = 10 * 60_000;

export type ActiveClock = {
  /** 止まっていた時間を除いた、始めてからの時間(ms)。呼ぶたびに、止まっていたかを確かめる */
  elapsed(): number;
  /** 止まっていたとみなして、数えなかった時間(ms) */
  paused(): number;
};

export function activeClock(opts: { now?: () => number; visible?: () => boolean } = {}): ActiveClock {
  const now = opts.now ?? Date.now;
  const visible = opts.visible ?? (() => typeof document === "undefined" || document.visibilityState === "visible");
  const start = now();
  let last = start;
  let paused = 0;
  const tick = () => {
    const t = now();
    const gap = t - last;
    if (gap > STALL_MS && visible()) paused = Math.min(MAX_PAUSED_MS, paused + gap);
    last = t;
    return t;
  };
  return {
    elapsed: () => tick() - start - paused,
    paused: () => paused,
  };
}
