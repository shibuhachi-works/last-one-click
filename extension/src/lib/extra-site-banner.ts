// 追加の対応先のページの中に出す知らせ(バナー)。note の編集画面のバナー(content.ts の banner())と同じ作りにする:
// - 右下に出す。ページの DOM を汚さないよう shadow DOM に閉じる(ページのセレクタにも当たらない)
// - 入れているあいだは、回る印と「操作せずにお待ちください」を出す。文だけを書き換えられる(showBannerStatus)
// - 空行(\n\n)より前を常に出し、後ろは「詳細」で開く。詳細の行は先頭の ✓・⚠・✗ で色を分ける
// - 「たたむ」で小さなピルにし、押すと戻る。入れ終えたら「閉じる」で消せる
// 色は、そのサイトのアイコンのような明るい多色にした(サイトのロゴや画像は使わない)。
// 中身はすべて textContent で入れる(innerHTML は使わない)
import { EXTRA_SITE_HOST } from "../../../shared/extra-site";

export type BannerKind = "info" | "ok" | "warn" | "error";

export const BANNER_ID = "last-one-click-extra-site-banner";

/** 知らせの見出し。どのサイト向けの知らせかが分かるように、入れる先のドメインを添える */
export const BANNER_TITLE = `Last One Click for ${EXTRA_SITE_HOST}`;

/** 種類ごとの色と、見出しの横に出す短いことば */
const KINDS: Record<BannerKind, { color: string; soft: string; label: string; mark: string }> = {
  info: { color: "#3b7cf6", soft: "#eaf1ff", label: "入力中", mark: "" },
  ok: { color: "#1fa56b", soft: "#e6f6ee", label: "入れました", mark: "✓" },
  warn: { color: "#e0890b", soft: "#fff3dd", label: "確認してください", mark: "!" },
  error: { color: "#e0464b", soft: "#fdeaea", label: "エラー", mark: "×" },
};

/** 詳細の行の先頭の印ごとの色 */
const LINE_COLORS: [RegExp, string][] = [
  [/^✓/, "#1fa56b"],
  [/^⚠/, "#c97400"],
  [/^✗/, "#d6363b"],
];

/** 上の帯の多色(赤・黄・緑・青・紫) */
const RAINBOW = "linear-gradient(90deg,#ff5f6d,#ffb340,#3ec97a,#3ea2ff,#9b6bff)";

const CSS = `
:host{all:initial}
@keyframes loc-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation-duration:3s}}
#box{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(560px,calc(100vw - 32px));max-height:70vh;display:flex;flex-direction:column;
  border-radius:14px;background:#fff;color:#1f2328;font:14px/1.6 system-ui,sans-serif;overflow:hidden;
  box-shadow:0 8px 28px rgba(20,30,60,.22),0 1px 3px rgba(20,30,60,.12)}
#box[hidden],#pill[hidden],#det[hidden]{display:none}
.stripe{height:5px;background:${RAINBOW};flex:none}
.inner{padding:12px 16px 14px;overflow:auto}
.head{display:flex;align-items:center;gap:8px}
.badge{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;
  color:#fff;font:700 13px/1 system-ui,sans-serif}
.spin{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;
  animation:loc-spin .9s linear infinite}
.title{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.chip{flex:none;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.grow{flex:1}
.link{flex:none;white-space:nowrap;border:0;padding:0;background:none;color:#57606a;cursor:pointer;font:13px system-ui,sans-serif;text-decoration:underline;text-underline-offset:3px}
.link:hover{color:#1f2328}
#wait{margin-top:8px;padding:6px 10px;border-radius:8px;font-size:13px}
#sum{margin-top:8px;white-space:pre-wrap}
#det{margin-top:10px;padding:8px 10px;border-radius:8px;background:#f6f8fa;font-size:13px}
#det div{white-space:pre-wrap;padding:2px 0}
.foot{margin-top:10px;display:flex;justify-content:flex-end;gap:14px}
#pill{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:inline-flex;align-items:center;gap:6px;padding:6px 14px 6px 6px;
  border-radius:999px;background:#fff;color:#1f2328;font:600 12px system-ui,sans-serif;cursor:pointer;
  box-shadow:0 6px 20px rgba(20,30,60,.22);background-image:linear-gradient(#fff,#fff),${RAINBOW};
  background-origin:border-box;background-clip:padding-box,border-box;border:2px solid transparent}
#pill .badge{width:18px;height:18px;font-size:11px}
#pill .spin{width:9px;height:9px}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function badge(kind: BannerKind): HTMLElement {
  const k = KINDS[kind];
  const b = el("span", { class: "badge", "aria-hidden": "true" });
  b.style.background = k.color;
  if (kind === "info") b.append(el("span", { class: "spin" }));
  else b.textContent = k.mark;
  return b;
}

/**
 * 知らせを出す(出ていれば中身を入れ替える)。たたんでいたら、たたんだまま中身だけ変える。
 * kind が info のときは「入れている途中」として、回る印と操作を控えるお願いを出す
 */
export function showBanner(text: string, kind: BannerKind = "info") {
  let host = document.getElementById(BANNER_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = BANNER_ID;
    document.body.append(host);
    host.attachShadow({ mode: "open" });
  }
  const root = host.shadowRoot!;
  const wasCollapsed = root.getElementById("box")?.hidden === true;
  const k = KINDS[kind];
  const working = kind === "info";

  const sep = text.indexOf("\n\n");
  const summary = sep < 0 ? text : text.slice(0, sep);
  const details = sep < 0 ? [] : text.slice(sep + 2).trim().split("\n").filter((l) => l.trim());

  const box = el("div", { id: "box", role: working ? "status" : kind === "error" ? "alert" : "status" });
  box.dataset.kind = kind;
  const inner = el("div", { class: "inner" });
  box.append(el("div", { class: "stripe" }), inner);

  const head = el("div", { class: "head" });
  const chip = el("span", { class: "chip", id: "chip" }, k.label);
  chip.style.background = k.soft;
  chip.style.color = k.color;
  const min = el("button", { type: "button", id: "min", class: "link", "aria-label": "知らせをたたむ" }, "たたむ");
  head.append(badge(kind), el("span", { class: "title" }, BANNER_TITLE), chip, el("span", { class: "grow" }), min);
  let close: HTMLButtonElement | null = null;
  if (!working) {
    close = el("button", { type: "button", id: "close", class: "link", "aria-label": "知らせを閉じる" }, "閉じる");
    head.append(close);
  }
  inner.append(head);

  if (working) {
    const wait = el("div", { id: "wait" }, "処理中です。編集画面は操作せずにお待ちください。");
    wait.style.background = k.soft;
    inner.append(wait);
  }
  inner.append(el("div", { id: "sum" }, summary));

  if (details.length) {
    const det = el("div", { id: "det" });
    det.hidden = true;
    for (const line of details) {
      const d = el("div", {}, line);
      const c = LINE_COLORS.find(([re]) => re.test(line.trim()));
      if (c) d.style.color = c[1];
      det.append(d);
    }
    const tog = el("button", { type: "button", id: "tog", class: "link", "aria-expanded": "false", "aria-controls": "det" }, "詳細");
    tog.onclick = () => {
      det.hidden = !det.hidden;
      tog.textContent = det.hidden ? "詳細" : "詳細を閉じる";
      tog.setAttribute("aria-expanded", String(!det.hidden));
    };
    const foot = el("div", { class: "foot" });
    foot.append(tog);
    inner.append(det, foot);
  }

  const pill = el("button", { type: "button", id: "pill", "aria-label": `${BANNER_TITLE} の知らせを開く` });
  pill.append(badge(kind), document.createTextNode(`${BANNER_TITLE} · ${k.label} ▴`));

  box.hidden = wasCollapsed;
  pill.hidden = !wasCollapsed;
  min.onclick = () => {
    box.hidden = true;
    pill.hidden = false;
    pill.focus();
  };
  pill.onclick = () => {
    pill.hidden = true;
    box.hidden = false;
    min.focus();
  };
  if (close) close.onclick = () => host!.remove();

  root.replaceChildren(el("style", {}, CSS), box, pill);
}

/** 入れている途中の知らせの文だけを書き換える。途中の知らせが出ていなければ、新しく出す */
export function showBannerStatus(text: string) {
  const root = document.getElementById(BANNER_ID)?.shadowRoot;
  const box = root?.getElementById("box");
  const sum = root?.getElementById("sum");
  if (box?.dataset.kind === "info" && sum) sum.textContent = text;
  else showBanner(text, "info");
}
