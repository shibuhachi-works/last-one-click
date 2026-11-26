// note の編集画面の content script で使う、DOM を探す・待つ・入れるための小さな道具(content.ts から分けた。動きは変えていない)。
import { normalizeLabel } from "../../../../shared/forbidden-click";
import { matchesAnyText } from "../../../../shared/text-match";
import { activeClock, type ActiveClock } from "../../../../shared/active-clock";
import { bannerStatus } from "./banner";

/** contenteditable の中の target の先頭(または末尾)にカーソルを置く。エディタは selectionchange で自分の選択範囲に取り込む */
export function placeCaret(root: HTMLElement, target: Node, where: "start" | "end") {
  const sel = window.getSelection();
  if (!sel || !root.contains(target)) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(where === "start");
  sel.removeAllRanges();
  sel.addRange(range);
}

/** セレクタに当たる要素のうち、画面に見えているもの(メニューの中身は閉じていると hidden) */
export function visibleMatch(selector: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(selector)).find((e) => e.offsetParent !== null || e.getClientRects().length > 0) ?? null
  );
}

/** 本文の中で、text がそのまま入っている所(1 つのテキストの中)を探す */
export function findTextRange(root: HTMLElement, text: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = (n.nodeValue ?? "").indexOf(text);
    if (i < 0) continue;
    const range = document.createRange();
    range.setStart(n, i);
    range.setEnd(n, i + text.length);
    return range;
  }
  return null;
}

export function selectRange(range: Range) {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

/** contenteditable の中の target の末尾にカーソルを置く。エディタは selectionchange で自分の選択範囲に取り込む */
export function caretToEnd(root: HTMLElement, target: Node) {
  const sel = window.getSelection();
  if (!sel || !root.contains(target)) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function waitFor<T extends HTMLElement = HTMLElement>(selector: string, timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const found = document.querySelector<T>(selector);
    if (found) return resolve(found);
    const obs = new MutationObserver(() => {
      const el = document.querySelector<T>(selector);
      if (el) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      obs.disconnect();
      reject(new Error(`要素が見つかりません: ${selector}`));
    }, timeout);
  });
}

/**
 * 文言でボタン等を探す(class 名より文言のほうが変わりにくい)。
 * 部分一致ではなく、正規化後の完全一致(textContent か aria-label)。`scope` を渡すとその中だけを探す
 */
/** 文字が候補のどれかに完全一致するボタン等をすべて返す */
export function findAllByText(tag: string, texts: string[], scope: ParentNode = document): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(tag)).filter((el) =>
    matchesAnyText([el.textContent, el.getAttribute("aria-label")], texts),
  );
}

/**
 * 文字が候補に(正規化後)完全一致する最小の要素を探し、その押せる祖先(button / menuitem / option / a / li)を返す。
 * メニュー項目のように「文字 + 補足」で組まれていて、ボタン全体の文字では一致しないものを押すため。
 * excludeSelector(記事本文など)と contenteditable の中は対象にしない
 */
export function findSmallestByText(texts: string[], excludeSelector: string): HTMLElement | null {
  // 実機のメニュー項目は「画像をアップロード」の文字と「推奨サイズ: …」が同じ要素に直接入っていて、
  // 文字が完全一致する要素が無い(test13 で確認)。そこで「文字を含む最小の要素」にする
  const norm = texts.map(normalizeLabel).filter((t) => t !== "");
  const contains = (el: Element) => {
    const t = normalizeLabel(el.textContent ?? "");
    return norm.some((n) => t.includes(n));
  };
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    if (!contains(el)) continue;
    if (el.closest(`[contenteditable="true"], textarea, ${excludeSelector}`)) continue; // 記事本文に同じ文字があっても押さない
    if (Array.from(el.children).some(contains)) continue; // より小さい子がある
    return el.closest<HTMLElement>('button, [role="menuitem"], [role="option"], a, li') ?? el;
  }
  return null;
}

/**
 * canvas に何か描かれているか。幅があるだけでは証拠にならない(未指定でも既定値 300)ので、
 * 画素を間引いて読み、透明でなく単色でもなければ描画済みとみなす。読めなければ(汚染など)false
 */
export function canvasHasContent(c: HTMLCanvasElement): boolean {
  try {
    const ctx = c.getContext("2d");
    if (!ctx || c.width === 0 || c.height === 0) return false;
    const seen = new Set<string>();
    for (let y = 0; y < c.height; y += Math.max(1, Math.floor(c.height / 8))) {
      for (let x = 0; x < c.width; x += Math.max(1, Math.floor(c.width / 8))) {
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
        if (a > 0) seen.add(`${r},${g},${b},${a}`);
      }
    }
    return seen.size >= 2;
  } catch {
    return false;
  }
}

/** 要素の短い説明(タグ・id・role・文字の先頭)。「現れた要素」の一覧用 */
export function describeShort(el: HTMLElement): string {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const role = el.getAttribute("role");
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${role ? `[role=${role}]` : ""}${text ? ` "${text.slice(0, 30)}${text.length > 30 ? "…" : ""}"` : ""}`;
}

/** fn が null 以外を返すまで 250 ms おきに試す(timeout で null) */
export async function waitUntil<T>(fn: () => T | null, timeout: number): Promise<T | null> {
  const until = Date.now() + timeout;
  for (;;) {
    const r = fn();
    if (r !== null) return r;
    if (Date.now() >= until) return null;
    await sleep(250);
  }
}

/**
 * waitUntil と同じ。待っているあいだ、1 秒ごとに経過した秒数をバナーに出す。
 * note のダイアログなどでページが止まっていた時間は、待ち時間に数えない(shared/active-clock.ts)
 */
export async function waitWithStatus<T>(fn: () => T | null, timeout: number, status: (sec: number, pausedMs: number) => string): Promise<T | null> {
  const clock: ActiveClock = activeClock();
  const show = () => bannerStatus(status(Math.floor(clock.elapsed() / 1000), clock.paused()));
  show();
  const timer = setInterval(show, 1000);
  try {
    for (;;) {
      const r = fn();
      if (r !== null) return r;
      if (clock.elapsed() >= timeout) return null;
      await sleep(250);
    }
  } finally {
    clearInterval(timer);
  }
}

/** 止まっていた時間があれば、数えていないことを添える */
export function pausedNote(ms: number): string {
  return ms >= 1_000 ? `(止まっていた ${Math.round(ms / 1000)} 秒は数えていません)` : "";
}

/** 120000 → 「2 分」、30000 → 「30 秒」 */
export function formatWait(ms: number): string {
  return ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} 分` : `${Math.round(ms / 1000)} 秒`;
}

export function findByText(tag: string, texts: string[], scope: ParentNode = document): HTMLElement | null {
  const all = Array.from(scope.querySelectorAll<HTMLElement>(tag));
  for (const t of texts) {
    const hit = all.find((el) => matchesAnyText([el.textContent, el.getAttribute("aria-label")], [t]));
    if (hit) return hit;
  }
  return null;
}

/** トグル / チェックボックス風のボタンがオンか(aria-checked / aria-pressed / data-active) */
export function isToggledOn(el: HTMLElement): boolean {
  return ["aria-checked", "aria-pressed", "data-active"].some((attr) => el.getAttribute(attr) === "true");
}

/** label(中のチェックボックス)や option が選択済みか */
export function isSelected(el: HTMLElement): boolean {
  if (isToggledOn(el) || el.getAttribute("aria-selected") === "true") return true;
  if (el instanceof HTMLOptionElement) return el.selected;
  const input = el instanceof HTMLInputElement ? el : el.querySelector<HTMLInputElement>("input[type=checkbox], input[type=radio]");
  return Boolean(input?.checked);
}

/** 開いているダイアログ(モーダル)。無ければ null */
export function findDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('dialog[open], [role="dialog"], [aria-modal="true"]');
}

/** React / Vue 管理下の input に値を入れて、フレームワーク側に変更を気づかせる */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function base64ToFile(t: { name: string; mimeType: string; base64: string }): File {
  const bin = atob(t.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], t.name, { type: t.mimeType });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
