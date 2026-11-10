// 診断モード:note のページ上にある「セレクタの候補になりそうな要素」を一覧にする。
// selectors/note.json が合わなくなった時に、このレポートを貼ってもらえば
// 実機を見なくても直せる、というのが狙い。認証情報やページ本文は含めない。
import { findEyecatchButton } from "../../../shared/eyecatch-button";
import type { Selectors } from "./types";

const MAX_PER_GROUP = 60;
const TEXT_LEN = 40;

export function buildDiagnosticReport(S: Selectors): string {
  const lines: string[] = [];
  lines.push(`# Last One Click 診断レポート`);
  lines.push(`url: ${location.origin}${location.pathname}`); // クエリは除く
  lines.push(`title: ${document.title}`);
  lines.push(`selectors.version: ${S.version}`);
  lines.push(``);

  // 1. 今の selectors/note.json が何件マッチするか
  lines.push(`## 現在の selectors/note.json のマッチ数`);
  const checks: [string, string][] = [
    ["title", S.title],
    ["body", S.body],
    ["thumbnail.fileInput", S.thumbnail.fileInput],
    ["thumbnail.addButton", S.thumbnail.addButton],
    ["publishSettings.hashtagInput", S.publishSettings.hashtagInput],
    ["publishSettings.magazineItem", S.publishSettings.magazineItem],
    ["toc.openMenuButton", S.toc.openMenuButton],
    ["toc.itemSelector", S.toc.itemSelector],
  ];
  for (const [key, sel] of checks) lines.push(`- ${key}: ${count(sel)} 件  \`${sel}\``);
  const textChecks: [string, string[]][] = [
    ["thumbnail.addButtonText", S.thumbnail.addButtonText],
    ["thumbnail.uploadMenuText", S.thumbnail.uploadMenuText],
    ["thumbnail.confirmText", S.thumbnail.confirmText],
    ["openPublishSettingsText", S.openPublishSettingsText],
    ["publishSettings.magazineToggleText", S.publishSettings.magazineToggleText],
    ["publishSettings.magazineAddButtonText", S.publishSettings.magazineAddButtonText],
    ["publishSettings.publishButtonText", S.publishSettings.publishButtonText],
    ["toc.itemText", S.toc.itemText],
  ];
  for (const [key, texts] of textChecks) {
    const hits = texts.map((t) => `${t}:${countByText("button", t)}`).join(", ");
    lines.push(`- ${key}: ${hits}`);
  }
  lines.push(``);

  // 2. 見出し画像のボタン(文字も aria-label も無いアイコンボタン)を、タイトル欄の位置からどれに決めるか
  const title = document.querySelector<HTMLElement>(S.title);
  lines.push(`## 見出し画像のボタン(タイトル欄の位置から判定)`);
  if (!title) lines.push(`- タイトル欄が無いので判定できません`);
  else {
    lines.push(`- タイトル欄 ${rect(title)}: ${describe(title)}`);
    const chosen = findEyecatchButton(title);
    lines.push(`- 判定: ${chosen ? `${rect(chosen)} ${describe(chosen)}` : "見つかりません"}`);
    const icons = Array.from(document.querySelectorAll<HTMLElement>("button")).filter(
      (b) => !(b.textContent ?? "").trim() && !b.getAttribute("aria-label"),
    );
    lines.push(`- アイコンボタン一覧 (${icons.length} 件):`);
    for (const b of icons.slice(0, 20)) lines.push(`  - ${rect(b)} ${describe(b)}`);
  }
  lines.push(``);

  // 3. 候補要素の一覧
  section(lines, "入力欄 (input / textarea)", "input:not([type=hidden]), textarea");
  section(lines, "contenteditable", "[contenteditable='true'], [contenteditable='']");
  section(lines, "file input (hidden 含む)", "input[type='file']");
  section(lines, "ボタン", "button, [role='button'], input[type='submit']");
  section(lines, "チェックボックス / ラベル / option", "input[type='checkbox'], label, [role='option'], [role='menuitem']");

  return lines.join("\n");
}

function section(lines: string[], name: string, selector: string) {
  const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
  lines.push(`## ${name} (${els.length} 件${els.length > MAX_PER_GROUP ? `、先頭 ${MAX_PER_GROUP} 件のみ` : ""})`);
  for (const el of els.slice(0, MAX_PER_GROUP)) lines.push(`- ${describe(el)}`);
  lines.push(``);
}

export function describe(el: HTMLElement): string {
  const parts: string[] = [el.tagName.toLowerCase()];
  if (el.id) parts.push(`#${el.id}`);
  const cls = Array.from(el.classList).slice(0, 4).join(".");
  if (cls) parts.push(`.${cls}`);

  const attrs: string[] = [];
  for (const a of ["type", "name", "placeholder", "data-placeholder", "aria-label", "role", "accept", "contenteditable", "aria-haspopup", "aria-expanded", "aria-controls", "aria-pressed"]) {
    const v = el.getAttribute(a);
    if (v) attrs.push(`${a}="${v.slice(0, TEXT_LEN)}"`);
  }
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith("data-") && a.name !== "data-placeholder") attrs.push(`${a.name}="${a.value.slice(0, 24)}"`);
  }
  if (attrs.length) parts.push(`[${attrs.join(" ")}]`);

  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text) parts.push(`"${text.slice(0, TEXT_LEN)}${text.length > TEXT_LEN ? "…" : ""}"`);

  parts.push(isVisible(el) ? "(visible)" : "(hidden)");
  parts.push(`path: ${cssPath(el)}`);
  return parts.join(" ");
}

/** 画面上の位置(スクロール込み)。見出し画像のボタンをタイトル欄との位置関係で決めるため */
export function rect(el: HTMLElement): string {
  const r = el.getBoundingClientRect();
  return `@(${Math.round(r.left + scrollX)},${Math.round(r.top + scrollY)} ${Math.round(r.width)}x${Math.round(r.height)})`;
}

function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

/** 短めの CSS パス(id があればそこで打ち切る) */
function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && parts.length < 6) {
    let s = cur.tagName.toLowerCase();
    if (cur.id) {
      parts.unshift(`#${cur.id}`);
      break;
    }
    const cls = Array.from(cur.classList).slice(0, 2).join(".");
    if (cls) s += `.${cls}`;
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      if (same.length > 1) s += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(s);
    cur = parent;
  }
  return parts.join(" > ");
}

function count(selector: string): number {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return -1; // 不正なセレクタ
  }
}

function countByText(tag: string, text: string): number {
  return Array.from(document.querySelectorAll<HTMLElement>(tag)).filter((el) => el.textContent?.includes(text)).length;
}
