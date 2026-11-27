// 追加の対応先(library.libecity.com)の新規記事のエディタで、画面の構造を調べるレポートを作る(#118)。
// 下書きの入力に使うセレクタを、実機を見ずに決めるため。note の診断(./diagnose.ts)と同じ形で、
// 中身は出さず、有無・件数・文字数・セレクタの道筋だけを出す。
// 読むだけ: ボタンを押さない、入力しない、フォーカスを動かさない、外へ送らない。
// 記事のタイトル・本文・アカウントの名前や ID は出さない(レポートは公開の Issue に貼ってもらう)
import { EXTRA_SITE_EDITOR_PROBE } from "../../../shared/extra-site";
import { isForbiddenClickText } from "../../../shared/forbidden-click";
import { redact } from "./diagnose-account";
import { cssPath, isVisible } from "./diagnose";

const MAX_PER_GROUP = 60;
/** 選ぶ画面の中は、選択肢が多いことがあるので多めに出す */
const MAX_CHOICES = 200;
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

/** 人の名前が入ることのある属性 */
const FREE_TEXT_ATTRS = ["placeholder", "data-placeholder", "aria-label", "title"];

const FIELD_SELECTOR = "input:not([type=hidden]):not([type=file]), textarea, [contenteditable]:not([contenteditable='false'])";
const BUTTON_SELECTOR = "button, [role='button'], input[type='submit'], input[type='button']";

/** アカウントの表示(アイコン・メニュー)らしい要素の class・id の手がかり */
const ACCOUNT_HINT = /avatar|account|profile|user|member|mypage/i;
/** アカウントの表示らしい要素。画像(アイコン)を含むか、class・id がアカウントらしい。その中も含む */
const ACCOUNT_SELECTOR = "img, picture, svg image";

export function buildExtraSiteReport(): string {
  const lines: string[] = [];
  lines.push(`# Last One Click 診断レポート(追加の対応先)`);
  lines.push(`(貼る前に、名前・ID・記事の中身が入っていないか目で確かめてください)`);
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

  // 7. 記事の設定のタグ・カテゴリの欄の中(入れ方と、入ったかの確かめ方を決めるため)。要素を上から順に出す
  // 見えているタグの欄を使う(ページ上部の隠れた検索欄も placeholder に「タグ」を含む)
  const tagInput = all("input[placeholder*='タグ']").find(isVisible);
  const tagItem = tagInput ? (tagInput.closest<HTMLElement>(".article_setting_item") ?? tagInput.parentElement) : null;
  list(lines, "タグの欄の中(タグの入力欄を含む設定の項目)", tagItem ? [tagItem, ...descendants(tagItem)] : []);
  const categoryItem = all(".article_category, .btn_selectCategory").map((el) => el.closest<HTMLElement>(".article_setting_item") ?? el).find(Boolean);
  list(lines, "カテゴリの欄の中", categoryItem ? [categoryItem, ...descendants(categoryItem)] : []);

  // 8. 開いているダイアログ(カテゴリを選ぶ画面など)の中。選択肢の文字は出す(選ぶときに文字で探すため)。
  // ダイアログの形でない選ぶ画面もあるので、class にカテゴリ・ポップアップらしい名前を持つ、見えている要素も見る
  // (記事の設定の中のカテゴリの欄は 7. で出すので除く)
  const pickerLike = all("[class*='category' i], [class*='modal' i], [class*='popup' i], [class*='picker' i], [class*='dropdown' i], [class*='overlay' i]").filter(
    (el) => isVisible(el) && !el.closest(".article_setting_item") && !el.closest("#article_setting_menu"),
  );
  const outermost = pickerLike.filter((el) => !pickerLike.some((o) => o !== el && o.contains(el)));
  const dialogs = [...all(".modal.show, [role='dialog'], [aria-modal='true'], dialog[open]").filter(isVisible), ...outermost].filter(
    (el, i, a) => a.indexOf(el) === i && !a.some((o) => o !== el && o.contains(el)),
  );
  if (!dialogs.length) list(lines, "開いているダイアログ・選ぶ画面らしいもの", []);
  for (const d of dialogs.slice(0, 3)) {
    const els = [d, ...descendants(d)].filter(isVisible);
    // 選択肢が多いことがあるので、ここだけ多めに出す
    lines.push(`## 開いているダイアログ・選ぶ画面らしいものの中 (${els.length} 件${els.length > MAX_CHOICES ? `、先頭 ${MAX_CHOICES} 件のみ` : ""})`);
    for (const el of els.slice(0, MAX_CHOICES)) lines.push(`- ${describeSafe(el, { choiceText: true })}`);
    lines.push(``);
  }

  // 9. アカウントの表示らしい所の作り(ログイン中のアカウントを、ポップアップに出す場所を決めるため)。
  // 隠れているもの(スマホ用のメニューなど)も出す。名前・ID の文字は出さず、長さだけ(describeSafe がアカウントらしい要素の文字を伏せる)。
  // 画像は、src が https かどうかだけを出す(URL は出さない)
  const accountRoots = all("[id], [class]").filter((el) => ACCOUNT_HINT.test(`${el.id} ${el.getAttribute("class") ?? ""}`));
  const accountTop = accountRoots.filter((el) => !accountRoots.some((o) => o !== el && o.contains(el)));
  const accountEls = accountTop.flatMap((el) => [el, ...descendants(el)]);
  lines.push(`## アカウントの表示らしい所の中(隠れているものも。文字は長さだけ) (${accountEls.length} 件${accountEls.length > MAX_PER_GROUP ? `、先頭 ${MAX_PER_GROUP} 件のみ` : ""})`);
  for (const el of accountEls.slice(0, MAX_PER_GROUP)) {
    const img = el instanceof HTMLImageElement ? ` [画像: src ${el.src.startsWith("https://") ? "https" : el.src ? "https 以外" : "無し"}]` : "";
    lines.push(`- ${describeSafe(el)}${img}`);
  }
  lines.push(``);

  // アカウントの表示らしい要素の文字・aria-label・title と、画像の alt を、レポート全体から伏せる
  // (要素ごとの行では出さないが、ほかの要素の aria-label などに同じ名前が入ることがある)
  return redact(lines.join("\n"), accountSecrets());
}

/** アカウントの表示らしい要素か(自分か祖先が、画像を含むボタン・リンクか、class・id がアカウントらしい) */
export function isAccountLike(el: HTMLElement): boolean {
  for (let cur: Element | null = el; cur && cur !== document.body; cur = cur.parentElement) {
    if (ACCOUNT_HINT.test(`${cur.id} ${cur.getAttribute("class") ?? ""}`)) return true;
    if (cur.matches("button, a, [role='button']") && cur.querySelector(ACCOUNT_SELECTOR)) return true;
  }
  return false;
}

/** 伏せる文字列: アカウントの表示らしい要素の文字(テキストのかたまりごと)・aria-label・title と、画像の alt */
function accountSecrets(): Set<string> {
  const secrets = new Set<string>();
  const add = (v: string | null | undefined) => {
    const t = (v ?? "").replace(/\s+/g, " ").trim();
    if (t.length >= 2 && t.length <= 60) secrets.add(t);
  };
  for (const img of all("img[alt]")) add(img.getAttribute("alt"));
  for (const el of all("body *")) {
    if (!isAccountLike(el)) continue;
    add(el.getAttribute("aria-label"));
    add(el.getAttribute("title"));
    for (const node of Array.from(el.childNodes)) if (node.nodeType === Node.TEXT_NODE) add(node.textContent);
  }
  return secrets;
}

function list(lines: string[], name: string, els: HTMLElement[]) {
  lines.push(`## ${name} (${els.length} 件${els.length > MAX_PER_GROUP ? `、先頭 ${MAX_PER_GROUP} 件のみ` : ""})`);
  for (const el of els.slice(0, MAX_PER_GROUP)) lines.push(`- ${describeSafe(el)}`);
  lines.push(``);
}

/**
 * 要素を 1 行で書く。note の診断の describe より控えめにする(相手の画面のことはまだ分からないため):
 * - data-* は名前だけ(値に人や記事の ID が入ることがある)
 * - 入力欄・書ける欄とその中、それを包む要素(エディタの外枠など)は、文字の長さだけ
 * - アカウントの表示らしい要素(画像の入ったボタン・リンクとその中、class・id がアカウントらしいもの)は、
 *   文字も aria-label・title・placeholder も長さだけ
 * - 4 桁以上の数字・メールアドレスの形は伏せる
 */
export function describeSafe(el: HTMLElement, opts: { choiceText?: boolean } = {}): string {
  const parts: string[] = [el.tagName.toLowerCase()];
  if (el.id) parts.push(`#${mask(el.id)}`);
  const cls = Array.from(el.classList).slice(0, 4).map(mask).join(".");
  if (cls) parts.push(`.${cls}`);

  // アカウントの表示らしい要素は、文字の入る属性(aria-label・title・placeholder)も長さだけにする
  const account = isAccountLike(el);
  const attrs: string[] = [];
  for (const a of ["type", "name", "placeholder", "data-placeholder", "aria-label", "title", "role", "accept", "multiple", "contenteditable", "aria-haspopup", "aria-expanded"]) {
    const v = el.getAttribute(a);
    if (v === null) continue;
    if (!v) attrs.push(a);
    else if (account && FREE_TEXT_ATTRS.includes(a)) attrs.push(`${a}=(${v.length} 字)`);
    else attrs.push(`${a}="${mask(v.slice(0, TEXT_LEN))}"`);
  }
  // 隠れた input は、値が入っているかと長さだけ出す(カテゴリの送る値が空になっていないかを見るため。中身は出さない)
  if (el instanceof HTMLInputElement && el.type === "hidden") attrs.push(el.value ? `value=(${el.value.length} 字)` : "value 空");
  const data = Array.from(el.attributes).filter((a) => a.name.startsWith("data-") && a.name !== "data-placeholder").map((a) => a.name);
  if (data.length) attrs.push(`data: ${data.slice(0, 6).join(",")}`);
  if (attrs.length) parts.push(`[${attrs.join(" ")}]`);

  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const hidesText = opts.choiceText ? holdsTypedText(el) : holdsArticleText(el);
  if (text && (hidesText || account)) parts.push(`(文字 ${text.length} 字は出しません)`);
  else if (text) parts.push(`"${mask(text.slice(0, TEXT_LEN))}${text.length > TEXT_LEN ? "…" : ""}"`);

  parts.push(isVisible(el) ? "(visible)" : "(hidden)");
  parts.push(`path: ${mask(cssPath(el))}`);
  return parts.join(" ");
}

const EDITABLE = "[contenteditable]:not([contenteditable='false']), textarea, input, select";

/** 記事の文字が入る欄か、その中の要素か、それを包む要素か(入力欄・書ける欄。エディタの外枠も本文を含む) */
function holdsArticleText(el: HTMLElement): boolean {
  return el.isContentEditable || !!el.closest(EDITABLE) || !!el.querySelector(EDITABLE);
}

/** 文字を打つ欄(選ぶだけの radio・checkbox は除く)か、その中か、それを包む要素か。選ぶ画面の選択肢の文字は出すため */
function holdsTypedText(el: HTMLElement): boolean {
  const typed = "[contenteditable]:not([contenteditable='false']), textarea, select, input:not([type=radio]):not([type=checkbox]):not([type=button]):not([type=submit])";
  return el.isContentEditable || !!el.closest(typed) || !!el.querySelector(typed);
}

/** el の中の要素(上から順) */
function descendants(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>("*"));
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
