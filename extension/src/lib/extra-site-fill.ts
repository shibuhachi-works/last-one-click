// 追加の対応先(library.libecity.com)の編集画面に、記事を下書きとして入れる(#120)。
// 今開いているタブに入れて止まる。新しいタブは開かない。
// 押さない: 「確認画面へ」(公開へ進む)・「下書き保存」(人が中身を確かめてから押す)・「公開」「投稿」を含むもの。
// 押してよいのは、記事の設定がたたまれているときの開くボタン、外部公開の範囲の radio・読了目安時間の checkbox、
// 公認タグの候補、カテゴリを選ぶ画面(開くボタン・大きなカテゴリの開閉・小さなカテゴリ・閉じるボタン)だけ
// (どれも safeClick に EXTRA_SITE_FORBIDDEN_CLICK_SUBSTRINGS を渡す)。
// 記事の設定の「要約」・外部公開の範囲・読了目安時間は front matter に書いてあれば入れる(押すのは radio・checkbox だけ)。
// カテゴリは、front matter の category(「大 > 小」か小だけ)と名前がちょうど 1 つ合うときだけ選ぶ。
// 画面の作りは #119 の診断から決めた(shared/extra-site.ts の EXTRA_SITE_DEFAULT_SELECTORS)
import { acceptsFile, extraSiteSelectors, type ExtraSiteArticle, type ExtraSiteSelectors } from "../../../shared/extra-site";
import { EXTRA_SITE_FORBIDDEN_CLICK_SUBSTRINGS } from "../../../shared/forbidden-click";
import { htmlToText } from "../../../shared/markdown-safe";
import { safeClick } from "./safe-click";

export type FillOptions = {
  selectors?: ExtraSiteSelectors;
  /** 本文の画像 1 枚のアップロードを待つ長さ */
  imageWaitMs?: number;
  /** 欄が出るのを待つ長さ */
  fieldWaitMs?: number;
  /** タグを入れる前に、記事の設定の画面が落ち着くのを待つ長さ(変わらなければ落ち着いたとみる長さ・最長) */
  settleQuietMs?: number;
  settleMaxMs?: number;
  /** いま進めていることの文(「タグを入れています…」など)。ページの知らせの文を書き換えるのに使う */
  onProgress?: (what: string) => void;
};

/** 入れ終えたときの結果。lines はバナーに出す 1 行ずつ(✓・⚠・✗ で始まる) */
export type FillResult = { ok: boolean; lines: string[] };

const IMAGE_WAIT_MS = 30_000;
const FIELD_WAIT_MS = 10_000;
/** タグを入れ終えてから、消えていないかを数え直すまでの長さ */
const TAG_RECHECK_MS = 1_500;
const SETTLE_QUIET_MS = 1_000;
const SETTLE_MAX_MS = 10_000;

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

  const summary = article.summary?.trim() ?? "";
  const settings = article.thumbnail || article.hashtags.length || summary || article.publishScope || article.readingTime !== undefined || article.category?.trim();
  if (settings) {
    await step("記事の設定を開く", () => openSettings(S, fieldWait));
  }
  if (article.thumbnail) await step("見出し画像", () => setEyecatch(S, article.thumbnail!, fieldWait));
  if (article.publishScope) await step("外部公開の範囲", () => setPublishScope(S, article.publishScope!, fieldWait));
  const category = article.category?.trim() ?? "";
  if (category) await step("カテゴリ", () => setCategory(S, category, fieldWait));
  if (summary) await step("要約", () => setSummary(S, summary, fieldWait));
  if (article.readingTime !== undefined) await step("読了目安時間", () => setReadingTime(S, article.readingTime!, fieldWait));
  // タグは最後に入れる(ほかの設定や見出し画像のアップロードで、記事の設定が作り直されたときに消えないように)
  const settle = { quietMs: opts.settleQuietMs ?? SETTLE_QUIET_MS, maxMs: opts.settleMaxMs ?? SETTLE_MAX_MS };
  if (article.hashtags.length) await step("タグ", () => addTags(S, article.hashtags, fieldWait, settle));

  for (const n of notes) lines.push(`⚠ 入らない書き方: ${n}`);
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
    onProgress?.(`本文の画像を入れています(${i + 1}/${images.length} 枚目)…`);
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
  if (skipped.length) problems.push(`png・jpg ではないので入れていません(${skipped.join(", ")})`);
  if (captions.length) problems.push(`キャプションは入れていません(${captions.join(", ")})`);
  if (stopped) problems.push("待ちきれなかった画像より後は入れていません");
  if (failed.length) problems.push(`入れられなかった画像があります(${failed.join(", ")})`);
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
  if (!open) throw new Error("記事の設定を開くボタンが見つかりません");
  click(open, "記事の設定を開く");
  if (!(await waitFor(S.tagInput, fieldWait))) throw new Error("記事の設定を開けませんでした");
  return "";
}

/** 見出し画像の欄にファイルを入れて change を起こす */
async function setEyecatch(S: ExtraSiteSelectors, thumb: NonNullable<ExtraSiteArticle["thumbnail"]>, fieldWait: number): Promise<string> {
  const input = await waitFor<HTMLInputElement>(S.eyecatchInput, fieldWait, { hidden: true });
  if (!input) throw new Error("見出し画像の欄が見つかりません");
  if (!acceptsFile(input.accept || "image/*", thumb)) throw new Error(`受け付けない種類の画像です(${thumb.name})`);
  setFiles(input, base64ToFile(thumb));
  return "";
}

/** 外部公開の範囲の radio を選ぶ(押すのは radio だけ。すでに選ばれていれば押さない) */
async function setPublishScope(S: ExtraSiteSelectors, scope: "public" | "limited", fieldWait: number): Promise<string> {
  const label = scope === "public" ? "全文公開" : "冒頭のみ公開";
  const radio = await waitFor<HTMLInputElement>(scope === "public" ? S.publishScopePublic : S.publishScopeLimited, fieldWait, { hidden: true });
  if (!radio || radio.type !== "radio") throw new Error(`「${label}」が見つかりません`);
  if (!radio.checked) click(radio, `外部公開の範囲: ${label}`);
  if (!(await waitUntil(() => (radio.checked ? true : null), 1_000))) throw new Error(`「${label}」を選べたか確認できませんでした`);
  return label;
}

/** カテゴリの「大 > 小」を分ける。区切りは >・＞・/・／。1 つだけなら小さなカテゴリ */
export function splitCategory(category: string): { main?: string; sub: string } {
  const parts = category.split(/\s*[>＞/／]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { main: parts[0], sub: parts[parts.length - 1]! };
  return { sub: parts[0] ?? "" };
}

/** 比べるための形(空白を外す) */
function norm(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, "");
}

/**
 * カテゴリを選ぶ。「カテゴリを選択」を押して選ぶ画面を開き、名前がちょうど 1 つ合う小さなカテゴリを押す。
 * 合うものが無い・2 つ以上あるときは、何も選ばずに画面を閉じて知らせる。すでに同じカテゴリなら押さない
 */
async function setCategory(S: ExtraSiteSelectors, category: string, fieldWait: number): Promise<string> {
  const { main, sub } = splitCategory(category);
  if (!sub) throw new Error(`「${category}」を読めません。「大カテゴリ > 小カテゴリ」の形で書いてください`);
  const open = await waitFor(S.categoryOpen, fieldWait);
  if (!open) throw new Error("「カテゴリを選択」が見つかりません");
  const value = query<HTMLInputElement>(S.categoryValue, { hidden: true });
  // すでに選ばれていれば押さない。開くボタンの文字(「大 > 小」)を分けて、それぞれ名前全体で比べる
  const current = splitCategory(open.textContent ?? "");
  const same = norm(current.sub) === norm(sub) && (!main || norm(current.main) === norm(main));
  if (value?.value && current.main && same) return `${open.textContent?.trim()}(前から)`;

  click(open, "カテゴリを選択");
  const dialog = await waitFor(S.categoryDialog, fieldWait);
  if (!dialog) throw new Error("カテゴリを選ぶ画面が開きませんでした");
  const close = () => {
    const btn = queryIn<HTMLElement>(dialog, S.categoryClose);
    if (btn && isVisible(btn)) click(btn, "カテゴリを選ぶ画面を閉じる");
  };

  // 大きなカテゴリを書いていれば、その中だけを見る
  const groups = queryAllIn(document, S.categoryMain).filter((g) => !main || norm(queryIn(g, S.categoryMainName)?.textContent) === norm(main));
  if (main && !groups.length) {
    close();
    throw new Error(`「${main}」が見つかりません`);
  }
  const hits: { group: HTMLElement; button: HTMLElement }[] = [];
  for (const group of groups) {
    for (const button of queryAllIn(group, S.categorySub)) {
      const name = queryIn(button, S.categorySubName)?.textContent ?? button.textContent;
      if (norm(name) === norm(sub)) hits.push({ group, button });
    }
  }
  if (hits.length !== 1) {
    close();
    if (!hits.length) throw new Error(`「${category}」が見つかりません`);
    throw new Error(`「${sub}」が ${hits.length} つあります。「大カテゴリ > ${sub}」の形で書いてください`);
  }
  const { group, button } = hits[0]!;
  const mainName = queryIn(group, S.categoryMainName)?.textContent?.trim() ?? main ?? "";
  // 大きなカテゴリがたたまれていれば開く
  if (!isVisible(button)) {
    const toggle = queryIn<HTMLElement>(group, S.categoryMainToggle);
    if (toggle) click(toggle, `カテゴリ: ${mainName}を開く`);
    await waitUntil(() => (isVisible(button) ? true : null), 1_000);
  }
  const before = value?.value ?? "";
  click(button, `カテゴリ: ${mainName} > ${sub}`);
  const chosen = await waitUntil(() => {
    const v = query<HTMLInputElement>(S.categoryValue, { hidden: true });
    const t = splitCategory(query(S.categoryOpen, { hidden: true })?.textContent ?? "");
    return (v && v.value && v.value !== before) || norm(t.sub) === norm(sub) ? true : null;
  }, 2_000);
  // 選んでも開いたままなら閉じる
  await sleep(300);
  if (isVisible(dialog)) close();
  if (!chosen) throw new Error(`「${mainName} > ${sub}」を選べたか確認できませんでした`);
  return `${mainName} > ${sub}`;
}

/** root の中で、セレクタの候補を先頭から見て最初に当たった要素 */
function queryIn<T extends HTMLElement = HTMLElement>(root: ParentNode, selectors: string[]): T | null {
  for (const s of selectors) {
    try {
      const el = root.querySelector<T>(s);
      if (el) return el;
    } catch {
      // 書き方の誤ったセレクタは飛ばす
    }
  }
  return null;
}

/** root の中で、セレクタの候補のうち最初に 1 つ以上当たったものの全部 */
function queryAllIn(root: ParentNode, selectors: string[]): HTMLElement[] {
  for (const s of selectors) {
    try {
      const els = Array.from(root.querySelectorAll<HTMLElement>(s));
      if (els.length) return els;
    } catch {
      // 書き方の誤ったセレクタは飛ばす
    }
  }
  return [];
}

/** 読了目安時間を出すかの checkbox を合わせる(押すのは checkbox だけ。合っていれば押さない) */
async function setReadingTime(S: ExtraSiteSelectors, show: boolean, fieldWait: number): Promise<string> {
  const box = await waitFor<HTMLInputElement>(S.readingTime, fieldWait, { hidden: true });
  if (!box || box.type !== "checkbox") throw new Error("切り替えが見つかりません");
  if (box.checked !== show) click(box, "読了目安時間");
  if (!(await waitUntil(() => (box.checked === show ? true : null), 1_000))) throw new Error("切り替えられたか確認できませんでした");
  return show ? "表示する" : "表示しない";
}

/**
 * 要約の欄に入れる。欄に文字数の上限(maxlength)があり、要約がそれより長いときは入れずに知らせる
 * (途中で切ると、文の終わりが欠けたまま気づかれないため)
 */
async function setSummary(S: ExtraSiteSelectors, summary: string, fieldWait: number): Promise<string> {
  const el = await waitFor<HTMLTextAreaElement | HTMLInputElement>(S.summary, fieldWait);
  if (!el) throw new Error("要約の欄が見つかりません");
  const len = Array.from(summary).length;
  // maxlength は UTF-16 の単位で数える(絵文字などは 2 つ)。比べるのは同じ単位の summary.length
  if (el.maxLength > 0 && summary.length > el.maxLength) {
    throw new Error(`上限(${el.maxLength} 字)を超えています`);
  }
  el.focus();
  setNativeValue(el, summary);
  if (el.value !== summary) throw new Error("入ったか確認できませんでした");
  return `${len} 字`;
}

/**
 * タグを入れる。入れる前に、記事の設定の画面が落ち着く(しばらく作り直されない)のを待つ。
 * 入れ終えたあと少し待って数え直し、消えた・入らなかったタグは 1 回だけ入れ直す。
 * それでも残らなければ、消え方(タグの欄ごと作り直されたか、タグのボタンだけ消えたか)を添えて知らせる
 * (実機で、いったん入ったタグが消えた。候補のボタンで入れた公認タグも消えたので、送るイベントの違いではなく、
 * ページが記事の設定を作り直しているとみている)
 */
async function addTags(S: ExtraSiteSelectors, tags: string[], fieldWait: number, settle: Settle): Promise<string> {
  const want = [...new Set(tags.map((t) => t.replace(/^[#＃]/, "").trim()).filter(Boolean))];
  if (!want.length) return "0 個";
  await waitQuiet(query(S.settingsMenu) ?? document.body, settle);
  const firstInput = await waitFor<HTMLInputElement>(S.tagInput, fieldWait);
  if (!firstInput) throw new Error("タグの欄が見つかりません");
  // 前から入っているタグも含めて、画面に 1 つでもあれば入っているとみる(足した数ではなく、残っているかで見る)
  const missing = () => want.filter((t) => countTag(S, t) === 0);

  const first = await addTagsOnce(S, want, fieldWait);
  if (first.entered.length) await sleep(TAG_RECHECK_MS);
  let lost = missing();
  const gone1 = lost.filter((t) => first.entered.includes(t));
  if (!lost.length) return `${want.length} 個`;

  // 入れ直す前に、消え方を記録しておく(次に直すときの手がかり)
  console.warn(`[lastclick-pigeon] タグ: ${firstInput.isConnected ? "タグのボタンだけが消えていました" : "タグの欄ごと作り直されていました"}`);
  await waitQuiet(query(S.settingsMenu) ?? document.body, settle);
  const second = await addTagsOnce(S, lost, fieldWait);
  if (second.entered.length) await sleep(TAG_RECHECK_MS);
  lost = missing();
  const done = want.length - lost.length;
  if (!lost.length) {
    return `⚠ ${done} 個(入れ直しました: ${[...new Set([...gone1, ...first.failed])].join(", ")})`;
  }
  const gone = lost.filter((t) => first.entered.includes(t) || second.entered.includes(t));
  const failed = lost.filter((t) => !gone.includes(t));
  const problems: string[] = [];
  if (failed.length) problems.push(`確認できなかったタグ(${failed.join(", ")})`);
  if (gone.length) problems.push(`消えたタグ(${gone.join(", ")})`);
  throw new Error(`${done} 個。${problems.join("。")}`);
}

/**
 * タグを 1 つずつ入れる。すでに画面にあるタグは入れずに entered に入れる(二重に入れない)。
 * 少し待っても増えたままのタグを entered、増えなかったタグを failed に返す
 */
async function addTagsOnce(S: ExtraSiteSelectors, tags: string[], fieldWait: number): Promise<{ entered: string[]; failed: string[] }> {
  const entered: string[] = [];
  const failed: string[] = [];
  for (const tag of tags) {
    const input = await waitFor<HTMLInputElement>(S.tagInput, fieldWait);
    if (!input) throw new Error("タグの欄が見つかりません");
    const before = countTag(S, tag);
    if (before > 0) {
      entered.push(tag);
      continue;
    }
    const suggest = findSuggest(S, tag);
    if (suggest && !suggest.classList.contains("is_selected")) {
      // 公認タグは、候補のボタンを押して入れる(画面の「クリックするとタグが追加されます」と同じ)
      click(suggest, `公認タグ: #${tag}`);
    } else {
      // 手で打って Enter を押したときと同じく、input と keydown だけを送る。
      // 選ばれた印だけ残って画面に無い公認タグも、打って入れる(印の付いた候補を押すと外れることがあるため)
      input.focus();
      setInputValue(input, tag);
      input.dispatchEvent(enterEvent("keydown"));
    }
    // 増えたあと、少し待っても増えたままなら入ったとする(打っている途中だけ出るものを数えないように)
    const added = await waitUntil(() => (countTag(S, tag) > before ? true : null), 2_000);
    if (added) await sleep(500);
    if (added && countTag(S, tag) > before) entered.push(tag);
    else failed.push(tag);
  }
  return { entered, failed };
}

/** 画面が落ち着くのを待つ設定(しばらく作り直されなければ落ち着いたとみる) */
type Settle = { quietMs: number; maxMs: number };

/** root の中が quietMs のあいだ変わらなくなるまで待つ(最長 maxMs)。見出し画像のアップロードのあとなどに使う */
function waitQuiet(root: Node, { quietMs, maxMs }: Settle): Promise<void> {
  return new Promise((resolve) => {
    let timer = setTimeout(done, quietMs);
    const limit = setTimeout(done, maxMs);
    const mo = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(done, quietMs);
    });
    mo.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    function done() {
      mo.disconnect();
      clearTimeout(timer);
      clearTimeout(limit);
      resolve();
    }
  });
}

/** 「#タグ」の文字を、比べる形にそろえる(先頭の #・終わりの × の印・空白を外す) */
function tagText(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/^[#＃]/, "").replace(/[×✕]$/, "").trim();
}

/** 公認タグの候補のうち、文字が tag のもの */
function findSuggest(S: ExtraSiteSelectors, tag: string): HTMLElement | null {
  for (const s of S.tagSuggestItem) {
    try {
      const hit = Array.from(document.querySelectorAll<HTMLElement>(s)).find((el) => tagText(el.textContent) === tag);
      if (hit) return hit;
    } catch {
      // 書き方の誤ったセレクタは飛ばす
    }
  }
  return null;
}

/**
 * 入っているタグ tag の数。足したタグのボタン(tagItem)が見つかればそれを数え、
 * 見つからない作りなら、タグの欄と候補の並びの外にある tag の文字を数える
 */
function countTag(S: ExtraSiteSelectors, tag: string): number {
  for (const s of S.tagItem) {
    try {
      const items = Array.from(document.querySelectorAll<HTMLElement>(s));
      if (items.length || document.querySelector(s.split(" ")[0] ?? s)) return items.filter((el) => tagText(el.textContent) === tag).length;
    } catch {
      // 書き方の誤ったセレクタは飛ばす
    }
  }
  return countOutside(query(S.settingsMenu) ?? document.body, query<HTMLInputElement>(S.tagInput), tag, S.tagSuggest);
}

/**
 * Enter キーのイベント。KeyboardEvent の初期値では keyCode・which が 0 になるので、13 にしておく
 * (keyCode で Enter を見るページでも、押したのと同じに受け取れるように)
 */
function enterEvent(type: string): KeyboardEvent {
  const e = new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
  for (const k of ["keyCode", "which", "charCode"] as const) {
    Object.defineProperty(e, k, { get: () => (k === "charCode" && type !== "keypress" ? 0 : 13) });
  }
  return e;
}

/** scope の中で、入力欄と除く所(公認タグの候補の並びなど)の外に、tag の文字だけの要素がいくつあるか */
function countOutside(scope: HTMLElement, input: HTMLInputElement | null, tag: string, exclude: string[] = []): number {
  const skip: Element[] = [];
  for (const s of exclude) {
    try {
      skip.push(...Array.from(scope.querySelectorAll(s)));
    } catch {
      // 書き方の誤ったセレクタは飛ばす
    }
  }
  let n = 0;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (input && input.contains(t)) continue;
    if (skip.some((el) => el.contains(t))) continue;
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
    : "⚠️ 一部は入れられませんでした。";
  return {
    text: `${head}\n「下書き保存」か「確認画面へ」を押してください。\n\n${[notTouched(r), ...r.lines].filter(Boolean).join("\n")}`,
    kind: warn ? "warn" : "ok",
  };
}

/** 入れていない欄の知らせ。要約・カテゴリ・外部公開の範囲は、入れたとき(✓)だけ外す。全部入れたら空 */
function notTouched(r: FillResult): string {
  const filled = (name: string) => r.lines.some((l) => l.startsWith(`✓ ${name}`));
  const items = ["要約", "カテゴリ", "外部公開の範囲"].filter((name) => !filled(name));
  return items.length ? `${items.join("・")}は入れていません。` : "";
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

/** input に値を入れて、input だけを知らせる(手で打ったときと同じ。change は送らない) */
function setInputValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** React などが管理する input・textarea に値を入れて、変わったことを知らせる */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
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
