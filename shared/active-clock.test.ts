import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_PAUSED_MS, activeClock } from "./active-clock.js";

/** 時計を手で進める */
function fake(visible = () => true) {
  let t = 1_000_000;
  const clock = activeClock({ now: () => t, visible });
  return { clock, advance: (ms: number) => (t += ms) };
}

describe("activeClock", () => {
  it("こまめに測っているときは、そのまま数える", () => {
    const { clock, advance } = fake();
    for (let i = 0; i < 40; i++) {
      advance(250);
      clock.elapsed();
    }
    assert.equal(clock.elapsed(), 10_000);
    assert.equal(clock.paused(), 0);
  });

  it("ダイアログなどで長く止まっていた時間は数えない", () => {
    const { clock, advance } = fake();
    for (let i = 0; i < 5; i++) {
      advance(1_000); // 1 秒ごとに測っていた
      clock.elapsed();
    }
    advance(40_000); // ダイアログが開いていて、40 秒測れなかった
    assert.equal(clock.elapsed(), 5_000);
    assert.equal(clock.paused(), 40_000);
    advance(1_000);
    assert.equal(clock.elapsed(), 6_000);
  });

  it("タブが裏にあって間が空いたときは、止まっていたとみなさない(いつまでも待ち続けない)", () => {
    const { clock, advance } = fake(() => false);
    advance(60_000);
    assert.equal(clock.elapsed(), 60_000);
    assert.equal(clock.paused(), 0);
  });

  it("止まっていたとみなす時間には上限がある", () => {
    const { clock, advance } = fake();
    advance(MAX_PAUSED_MS + 30_000);
    assert.equal(clock.paused(), 0);
    assert.equal(clock.elapsed(), 30_000);
    assert.equal(clock.paused(), MAX_PAUSED_MS);
  });
});
