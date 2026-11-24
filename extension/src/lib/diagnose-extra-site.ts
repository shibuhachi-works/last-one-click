// 追加の対応先(library.libecity.com)の新規記事のエディタで、画面の構造を調べるレポートを作る(#118)。
// 下書きの入力に使うセレクタを、実機を見ずに決めるため。note の診断(./diagnose.ts)と同じ形で、
// 中身は出さず、有無・件数・文字数・セレクタの道筋だけを出す。
// 読むだけ: ボタンを押さない、入力しない、フォーカスを動かさない、外へ送らない。
// 記事のタイトル・本文・アカウントの名前や ID は出さない(レポートは公開の Issue に貼ってもらう)
import { EXTRA_SITE_EDITOR_PROBE } from "../../../shared/extra-site";
import { isForbiddenClickText } from "../../../shared/forbidden-click";
import { cssPath, isVisible } from "./diagnose";

const MAX_PER_GROUP = 60;
const TEXT_LEN = 40;

/** エディタの種類が分かる class の手がかり(class 名の一部) */
export const EDITOR_CLASS_HINTS = [
  "ProseMirror",
  "tiptap",
  "ql-editor",
  "ql-container",
  "DraftEditor",
  "public-DraftEditor",
  "codex-editor",
  "ce-block",
  "ck-editor",
  "ck-content",
  "tox-edit-area",
  "mce-content-body",
  "lexical",
  "slate",
  "editor-content",
  "note-editable",
  "fr-element",
  "w-e-text",
  "medium-editor",
  "CodeMirror",
  "markdown",
];

/** タイトルの入力欄らしいものの手がかり(placeholder・aria-label・name・id の文字。小文字で比べる) */
const TITLE_HINTS = ["タイトル", "題名", "見出し", "title", "subject", "headline"];
/** 画像を入れるためのボタンらしいものの手がかり(ボタンの文字・aria-label・title) */
const IMAGE_HINTS = ["画像", "写真", "image", "img", "photo", "picture", "アップロード", "upload", "ファイル", "file", "サムネイル", "アイキャッチ", "thumbnail", "cover"];

const FIELD_SELECTOR = "input:not([type=hidden]):not([type=file]), textarea, [contenteditable]:not([contenteditable='false'])";
const BUTTON_SELECTOR = "button, [role='button'], input[type='submit'], input[type='button']";

export function buildExtraSiteReport(): string {
  const lines: string[] = [];
  lines.push(`# Last One Click 診断レポート(追加の対応先)`);
  lines.push(`url: ${location.origin}${maskPath(location.pathname)}`); // クエリは除く。記事ごと・人ごとに変わる部分は *** にする
  // ページのタイトル(document.title)は出さない。記事のタイトルが入ることがある
  lines.push(``);

  // 1. 今の仮のセレクタ(shared/extra-site.ts の EXTRA_SITE_EDITOR_PROBE)が何件当たるか
  lines.push(`## 仮のセレクタのマッチ数`);
  for (const [key, selectors] of [["title", EXTRA_SITE_EDITOR_PROBE.title], ["body", EXTRA_SITE_EDITOR_PROBE.body]] as const) {
    for (const sel of selectors) lines.push(`- ${key}: ${count(sel)} 件  \`${sel}\``);
  }
  lines.push(``);

  // 2. タイトルの入力欄らしいもの
  const fields = all(FIELD_SELECTOR);
  const titles = fields.filter((el) => hasHint(TITLE_HINTS, [el.getAttribute("placeholder"), el.getAttribute("data-placeholder"), el.getAttribute("aria-label"), el.getAttribute("name"), el.id]));
  list(lines, "タイトルの入力欄らしいもの(placeholder・aria-label などに「タイトル」「title」)", titles);

  // 3. 本文の入力欄らしいもの: 書ける欄と、エディタの種類が分かる class
  list(lines, "書ける欄 (contenteditable)", all("[contenteditable]:not([contenteditable='false'])"));
  lines.push(`## エディタの種類の手がかり(class 名の一部)`);
  const hits = EDITOR_CLASS_HINTS.map((hint) => [hint, all(`[class*="${hint}"]`)] as const).filter(([, els]) => els.length > 0);
  if (!hits.length) lines.push(`- 見つかりません`);
  for (const [hint, els] of hits) {
    lines.push(`- ${hint}: ${els.length} 件`);
    for (const el of els.slice(0, 5)) lines.push(`  - ${describeSafe(el)}`);
  }
  lines.push(``);

  // 4. 画像を入れるためのボタン・file input
  list(lines, "file input (hidden 含む)", all("input[type='file']"));
  const buttons = all(BUTTON_SELECTOR);
  const [publish, others] = partition(buttons, isPublishButton);
  const imageButtons = others.filter((el) => hasHint(IMAGE_HINTS, [visibleText(el), el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("data-tooltip")]));
  list(lines, "画像を入れるためのボタンらしいもの", imageButtons);

  // 5. ボタンの一覧。公開・投稿のボタンは、あることだけを出す(文字も道筋も出さない)
  lines.push(`## 公開・投稿のボタン`);
  lines.push(`- ${publish.length ? `あります(${publish.length} 件。文字と道筋は出しません)` : "見つかりません"}`);
  lines.push(``);
  list(lines, "ボタン(公開・投稿のボタンを除く)", others);

  // 6. 入力欄の一覧(タイトルらしいもの以外も)
  list(lines, "入力欄 (input / textarea / contenteditable)", fields);

  return lines.join("\n");
}

function list(lines: string[], name: string, els: HTMLElement[]) {
  lines.push(`## ${name} (${els.length} 件${els.length > MAX_PER_GROUP ? `、先頭 ${MAX_PER_GROUP} 件のみ` : ""})`);
  for (const el of els.slice(0, MAX_PER_GROUP)) lines.push(`- ${describeSafe(el)}`);
  lines.push(``);
}

/**
 * 要素を 1 行で書く。note の診断の describe より控えめにする(相手の画面のことはまだ分からないため):
 * - data-* は名前だけ(値に人や記事の ID が入ることがある)
 * - 入力欄・書ける欄とその中、画像の入ったボタン(アイコンに名前が付くことがある)は、文字の長さだけ
 * - 4 桁以上の数字・メールアドレスの形は伏せる
 */
export function describeSafe(el: HTMLElement): string {
  const parts: string[] = [el.tagName.toLowerCase()];
  if (el.id) parts.push(`#${mask(el.id)}`);
  const cls = Array.from(el.classList).slice(0, 4).map(mask).join(".");
  if (cls) parts.push(`.${cls}`);

  const attrs: string[] = [];
  for (const a of ["type", "name", "placeholder", "data-placeholder", "aria-label", "title", "role", "accept", "multiple", "contenteditable", "aria-haspopup", "aria-expanded"]) {
    const v = el.getAttribute(a);
    if (v !== null) attrs.push(v ? `${a}="${mask(v.slice(0, TEXT_LEN))}"` : a);
  }
  const data = Array.from(el.attributes).filter((a) => a.name.startsWith("data-") && a.name !== "data-placeholder").map((a) => a.name);
  if (data.length) attrs.push(`data: ${data.slice(0, 6).join(",")}`);
  if (attrs.length) parts.push(`[${attrs.join(" ")}]`);

  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text && (holdsArticleText(el) || el.querySelector("img, svg image, picture"))) parts.push(`(文字 ${text.length} 字は出しません)`);
  else if (text) parts.push(`"${mask(text.slice(0, TEXT_LEN))}${text.length > TEXT_LEN ? "…" : ""}"`);

  parts.push(isVisible(el) ? "(visible)" : "(hidden)");
  parts.push(`path: ${mask(cssPath(el))}`);
  return parts.join(" ");
}

/** 記事の文字が入る欄か、その中の要素か(入力欄・書ける欄) */
function holdsArticleText(el: HTMLElement): boolean {
  return el.isContentEditable || !!el.closest("[contenteditable]:not([contenteditable='false']), textarea, input, select");
}

/** 公開・投稿のボタンか(押さない文字の一覧 shared/forbidden-click.ts で見る) */
function isPublishButton(el: HTMLElement): boolean {
  return [visibleText(el), el.getAttribute("aria-label"), el.getAttribute("title"), (el as HTMLInputElement).value].some((t) => isForbiddenClickText(t ?? ""));
}

function visibleText(el: HTMLElement): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function hasHint(hints: string[], values: (string | null | undefined)[]): boolean {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  return !!text && hints.some((h) => text.includes(h.toLowerCase()));
}

/** 4 桁以上の数字と、メールアドレスの形を伏せる */
export function mask(text: string): string {
  return text.replace(/[^\s"'@<>]+@[^\s"'@<>]+\.[a-z]{2,}/gi, "***@***").replace(/\d{4,}/g, "***");
}

/** パスのうち、数字を含む部分・長い部分(記事や人の ID になりやすい)を *** にする */
export function maskPath(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) => (/\d/.test(seg) || seg.length > 20 ? "***" : seg))
    .join("/");
}

function all(selector: string): HTMLElement[] {
  try {
    return Array.from(document.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

function count(selector: string): number {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return -1; // 不正なセレクタ
  }
}

function partition<T>(items: T[], test: (item: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const item of items) (test(item) ? yes : no).push(item);
  return [yes, no];
}
