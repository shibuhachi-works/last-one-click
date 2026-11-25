// 追加の対応先(library.libecity.com)の編集画面に、記事を下書きとして入れる(#120)。
// 今開いているタブに入れて止まる。新しいタブは開かない。
// 押さない: 「確認画面へ」(公開へ進む)・「下書き保存」(人が中身を確かめてから押す)・「公開」「投稿」を含むもの。
// 押してよいのは、記事の設定がたたまれているときの開くボタンだけ(safeClick に EXTRA_SITE_FORBIDDEN_CLICK_SUBSTRINGS を渡す)。
// 記事の設定の「要約」・カテゴリ・公開範囲には触らない(人が入れる)。
// 画面の作りは #119 の診断から決めた(shared/extra-site.ts の EXTRA_SITE_DEFAULT_SELECTORS)
import { EXTRA_SITE_HOST, acceptsFile, extraSiteSelectors, type ExtraSiteArticle, type ExtraSiteSelectors } from "../../../shared/extra-site";
import { EXTRA_SITE_FORBIDDEN_CLICK_SUBSTRINGS } from "../../../shared/forbidden-click";
import { htmlToText } from "../../../shared/markdown-safe";
import { safeClick } from "./safe-click";

export type FillOptions = {
  selectors?: ExtraSiteSelectors;
  /** 本文の画像 1 枚のアップロードを待つ長さ */
  imageWaitMs?: number;
  /** 欄が出るのを待つ長さ */
  fieldWaitMs?: number;
  /** いま進めていることの文(「タグを入れています…」など)。ページの知らせの文を書き換えるのに使う */
  onProgress?: (what: string) => void;
};

/** 入れ終えたときの結果。lines はバナーに出す 1 行ずつ(✓・⚠・✗ で始まる) */
export type FillResult = { ok: boolean; lines: string[] };

const IMAGE_WAIT_MS = 30_000;
const FIELD_WAIT_MS = 10_000;

/** このページで押すときは、いつもここを通す(「確認画面へ」「下書き保存」も押さない) */
function click(el: HTMLElement, context: string) {
  safeClick(el, `追加の対応先: ${context}`, { forbid: EXTRA_SITE_FORBIDDEN_CLICK_SUBSTRINGS });
}

export async function fillExtraSite(article: ExtraSiteArticle, notes: string[] = [], opts: FillOptions = {}): Promise<FillResult> {
  const S = opts.selectors ?? extraSiteSelectors();
  const fieldWait = opts.fieldWaitMs ?? FIELD_WAIT_MS;
  const lines: string[] = [];
  let ok = true;
  const step = async (name: string, fn: () => Promise<string> | string) => {
    opts.onProgress?.(name === "記事の設定を開く" ? "記事の設定を開いています…" : `${name}を入れています…`);
    try {
      const r = await fn();
      lines.push(r.startsWith("⚠") ? `${r.replace(/^⚠\s*/, `⚠ ${name}: `)}` : `✓ ${name}${r ? `: ${r}` : ""}`);
    } catch (e) {
      ok = false;
      lines.push(`✗ ${name}: ${(e as Error).message}`);
    }
  };

  await step("タイトル", async () => {
    const el = await waitFor<HTMLInputElement>(S.title, fieldWait);
    if (!el) throw new Error("タイトルの欄が見つかりません");
    el.focus();
    setNativeValue(el, article.title);
    return "";
  });

  let bodyOk = false;
  await step("本文", async () => {
    const body = await waitFor(S.body, fieldWait);
    if (!body) throw new Error("本文の欄が見つかりません");
    await pasteBody(body, article.html);
    bodyOk = true;
    return "";
  });

  if (bodyOk && (article.images?.length || article.imageNotes?.length)) {
    await step("本文の画像", () => insertBodyImages(S, article, opts.imageWaitMs ?? IMAGE_WAIT_MS, fieldWait, opts.onProgress));
  }

  if (article.thumbnail || article.hashtags.length) {
    await step("記事の設定を開く", () => openSettings(S, fieldWait));
  }
  if (article.thumbnail) await step("見出し画像", () => setEyecatch(S, article.thumbnail!, fieldWait));
  if (article.hashtags.length) await step("タグ", () => addTags(S, article.hashtags, fieldWait));

  for (const n of notes) lines.push(`⚠ ${EXTRA_SITE_HOST} のエディタでは入らない書き方: ${n}`);
  return { ok, lines };
}

/** 中を空にしてから、本文の HTML を貼り付ける。Lexical が貼り付けの HTML を自分のノードに直す */
async function pasteBody(body: HTMLElement, html: string) {
  body.focus();
  const range = document.createRange();
  range.selectNodeContents(body);
  selectRange(range);
  await sleep(100);
  // 選んだ中身を消す(beforeinput が出るので、エディタが自分で消す)
  document.execCommand("delete", false);
  await sleep(100);
  const dt = new DataTransfer();
  dt.setData("text/html", html);
  dt.setData("text/plain", htmlToText(html)); // innerHTML は使わない
  body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  await sleep(500);
}

/**
 * 本文の目印の位置にカーソルを置き、隠れたファイルの欄にファイルを入れて change を起こす。
 * 欄の accept に合わない画像(gif など)は入れず、目印を残して知らせる
 */
async function insertBodyImages(
  S: ExtraSiteSelectors,
  a: ExtraSiteArticle,
  imageWait: number,
  fieldWait: number,
  onProgress?: (what: string) => void,
): Promise<string> {
  const body = query(S.body);
  if (!body) throw new Error("本文の欄が見つかりません");
  const images = a.images ?? [];
  const failed: string[] = [];
  const skipped: string[] = [];
  /** 入れたが、キャプションは入れられなかった画像(このページのキャプションの欄は分かっていない) */
  const captions: string[] = [];
  let stopped = false;
  let done = 0;
  const input = images.length ? await waitFor<HTMLInputElement>(S.bodyImageInput, fieldWait, { hidden: true }) : null;
  for (const [i, img] of images.entries()) {
    onProgress?.(`本文の画像を入れています…(${i + 1}/${images.length} 枚目: ${img.name})`);
    if (!input) {
      failed.push(img.name);
      continue;
    }
    if (!acceptsFile(input.accept, img)) {
      skipped.push(img.name);
      continue;
    }
    const range = findTextRange(body, img.marker);
    if (!range) {
      failed.push(img.name);
      continue;
    }
    body.focus();
    selectRange(range);
    await sleep(200);
    const before = new Set(Array.from(body.querySelectorAll("img")));
    setFiles(input, base64ToFile(img));
    const added = await waitUntil(() => Array.from(body.querySelectorAll("img")).find((i) => !before.has(i)) ?? null, imageWait);
    if (!added) {
      // 待ちきれなかった画像が、あとで遅れて入ることがある。それを次の画像のものと取り違えて、
      // 次の画像の目印を消さないよう、残りの画像はここで入れるのをやめる
      failed.push(img.name, ...images.slice(i + 1).map((x) => x.name));
      stopped = true;
      break;
    }
    done++;
    if (img.caption) captions.push(img.name);
    // 目印が残っていれば消す
    const rest = findTextRange(body, img.marker);
    if (rest) {
      body.focus();
      selectRange(rest);
      await sleep(100);
      document.execCommand("delete", false);
      await sleep(100);
    }
  }
  const problems = [...(a.imageNotes ?? [])];
  if (skipped.length) problems.push(`${EXTRA_SITE_HOST} のエディタは png・jpg だけを受け付けるので、入れずに目印を残しました(${skipped.join(", ")})`);
  if (captions.length) problems.push(`キャプションは入れていません(${captions.join(", ")}。画面で入れてください)`);
  if (stopped) problems.push("アップロードを待ちきれなかった画像があったので、それより後の画像は入れていません");
  if (failed.length) problems.push(`入れられなかった画像があります(${failed.join(", ")}。本文に残っている目印の位置に、画面で入れてください)`);
  if (!problems.length) return `${done} 枚`;
  if (failed.length) throw new Error(`${done ? `${done} 枚は入れました。` : ""}${problems.join("。")}`);
  return `⚠ ${done} 枚は入れました。${problems.join("。")}`;
}

/**
 * 記事の設定(見出し画像・タグの欄がある所)が見えていなければ、開くボタンを押す。
 * 押してよいのは、この開くボタンだけ
 */
async function openSettings(S: ExtraSiteSelectors, fieldWait: number): Promise<string> {
  if (query(S.tagInput)) return "";
  const open = query(S.settingsMenuOpenButton);
  if (!open) throw new Error("記事の設定を開くボタンが見つかりません。画面で記事の設定を開いてから、もう一度入れてください");
  click(open, "記事の設定を開く");
  if (!(await waitFor(S.tagInput, fieldWait))) throw new Error("記事の設定を開けませんでした");
  return "";
}

/** 見出し画像の欄にファイルを入れて change を起こす */
async function setEyecatch(S: ExtraSiteSelectors, thumb: NonNullable<ExtraSiteArticle["thumbnail"]>, fieldWait: number): Promise<string> {
  const input = await waitFor<HTMLInputElement>(S.eyecatchInput, fieldWait, { hidden: true });
  if (!input) throw new Error("見出し画像の欄が見つかりません。画面で入れてください");
  if (!acceptsFile(input.accept || "image/*", thumb)) throw new Error(`${EXTRA_SITE_HOST} のエディタでは受け付けない種類の画像です(${thumb.name})。画面で入れてください`);
  setFiles(input, base64ToFile(thumb));
  return "";
}

/** タグを 1 つずつ入れて Enter。入ったか(欄が空になったか、欄の外にその文字が出たか)を確かめる */
async function addTags(S: ExtraSiteSelectors, tags: string[], fieldWait: number): Promise<string> {
  const failed: string[] = [];
  let done = 0;
  for (const raw of tags) {
    const tag = raw.replace(/^[#＃]/, "").trim();
    if (!tag) continue;
    const input = await waitFor<HTMLInputElement>(S.tagInput, fieldWait);
    if (!input) throw new Error("タグの欄が見つかりません");
    const scope = query(S.settingsMenu) ?? document.body;
    const before = countOutside(scope, input, tag);
    input.focus();
    setNativeValue(input, tag);
    const init = { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true };
    input.dispatchEvent(new KeyboardEvent("keydown", init));
    input.dispatchEvent(new KeyboardEvent("keypress", init));
    input.dispatchEvent(new KeyboardEvent("keyup", init));
    const entered = await waitUntil(() => {
      const now = query(S.tagInput) as HTMLInputElement | null;
      return countOutside(query(S.settingsMenu) ?? document.body, now, tag) > before ? true : null;
    }, 2_000);
    if (entered) done++;
    else failed.push(tag);
  }
  if (failed.length) throw new Error(`${done ? `${done} 個は入れました。` : ""}入ったか確かめられなかったタグがあります(${failed.join(", ")})。画面で確かめてください`);
  return `${done} 個`;
}

/** scope の中で、入力欄の外に tag の文字だけの要素がいくつあるか */
function countOutside(scope: HTMLElement, input: HTMLInputElement | null, tag: string): number {
  let n = 0;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (input && input.contains(t)) continue;
    const v = (t.nodeValue ?? "").trim().replace(/^[#＃]/, "").replace(/[×✕]$/, "").trim();
    if (v === tag) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 入れ終えたときの知らせ(出すのは ./extra-site-banner.ts)

/** 入れ終えたときのバナーの文 */
export function resultMessage(r: FillResult): { text: string; kind: "ok" | "warn" } {
  const warn = !r.ok || r.lines.some((l) => l.startsWith("⚠"));
  const head = r.ok
    ? "✅ 下書きを入れました。"
    : "⚠️ 一部は入れられませんでした。足りないものは画面で入れてください。";
  return {
    text: `${head}\n中身を確かめてから、画面の「下書き保存」を押してください。拡張は「下書き保存」も「確認画面へ」も押しません。\n要約・カテゴリ・公開範囲は入れていません。\n\n${r.lines.join("\n")}`,
    kind: warn ? "warn" : "ok",
  };
}

// ---------------------------------------------------------------------------
// 小さな道具

/** セレクタの候補を先頭から順に見て、最初に当たった要素。書き方の誤ったセレクタは飛ばす */
function query<T extends HTMLElement = HTMLElement>(selectors: string[], opts: { hidden?: boolean } = {}): T | null {
  for (const s of selectors) {
    let found: T[] = [];
    try {
      found = Array.from(document.querySelectorAll<T>(s));
    } catch {
      continue;
    }
    // ファイルの欄は隠れているのがふつうなので、見えているかは見ない
    const el = opts.hidden ? found[0] : found.find(isVisible);
    if (el) return el;
  }
  return null;
}

function isVisible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0;
}

async function waitFor<T extends HTMLElement = HTMLElement>(selectors: string[], timeout: number, opts: { hidden?: boolean } = {}): Promise<T | null> {
  return waitUntil(() => query<T>(selectors, opts), timeout);
}

async function waitUntil<T>(fn: () => T | null, timeout: number): Promise<T | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(100);
  }
}

/** React などが管理する input に値を入れて、変わったことを知らせる */
function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** ファイルの欄に、選んだのと同じようにファイルを入れる。ファイル選択の画面は開かない */
function setFiles(input: HTMLInputElement, file: File) {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** 本文の中で、text がそのまま入っている所(1 つのテキストの中) */
function findTextRange(root: HTMLElement, text: string): Range | null {
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

function selectRange(range: Range) {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function base64ToFile(t: { name: string; mimeType: string; base64: string }): File {
  const bin = atob(t.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], t.name, { type: t.mimeType });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
