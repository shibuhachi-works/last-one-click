// ポップアップ。入力を ArticlePayload に組み立てて chrome.storage に置き、
// note のエディタを新しいタブで開く。実際の入力は content.ts が行う。
import { parse as parseYaml } from "yaml";
import type { CurrentUser } from "../../shared/current-user";
import { sameNoteAccount } from "../../shared/note-account";
import { parseFrontMatter, targetProblem, type Destination } from "../../shared/article";
import { checkSelectorsUrl } from "../../shared/selectors-url";
import { articleOptionsLabel } from "../../shared/article-options";
import { REWRITE_UNDO_NOTE, checkNoteUrl, noteEditKey, noteUrlProblem } from "../../shared/note-rewrite";
import { collectFolderFiles, findRelative, findThumbnail, mimeTypeOf, pickArticleMarkdown, type FsDirEntry, type FsFileEntry } from "../../shared/bundle";
import { MAX_ZIP_ENTRIES, isBundleFile, readZip } from "../../shared/zip";
import { buildArticle, fetchMarkdownFromGitHub, fileToPayload, localImageNames, localImageSrcs, payloadToFile } from "./lib/article";
import {
  EXTRA_SITE_ENABLED,
  EXTRA_SITE_HOST,
  EXTRA_SITE_SUBMIT_LABEL,
  EXTRA_SITE_NEW_SUBMIT_LABEL,
  disableExtraSite,
  enableExtraSite,
  extraSiteUnsupportedNotes,
  EXTRA_SITE_ORIGIN,
  isExtraSiteUrl,
  pickExtraSiteTab,
  shouldFillExtraSite,
  shouldOfferExtraSite,
  type ExtraSiteOffer,
  syncExtraSite,
} from "../../shared/extra-site";
import { chromeExtraSiteApi } from "./lib/extra-site";
import { safeClick } from "./lib/safe-click";
import { loadSelectors } from "./lib/selectors";
import { loadPopupAccount } from "../../shared/popup-account";
import { STORAGE, type AccountResponse, type DiagnoseResponse, type ExtraSiteAccountResponse, type ExtraSiteFillResponse, type Message, type NoteArticleResponse, type NoteRewriteResponse, type WindowHandoff } from "./lib/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/**
 * 「note の下書きを作成」ボタンの名前。案内の文には、この関数でボタンの文字をそのまま入れる
 * (ボタンの名前を変えたときに、案内の文だけ古い名前のまま残らないように。shared/popup-labels.test.ts でも確かめる)
 */
const submitLabel = () => $("submit").textContent?.trim() || "note の下書きを作成";

// 別ウィンドウ表示。ツールバーのポップアップは Finder 等に切り替えた瞬間に閉じるので、
// ドラッグ＆ドロップで渡したいときは独立したウィンドウ(popup.html?window=1)で開く。
// 入力途中の状態(md・上書き欄とその編集状態・画像・baseUrl)は chrome.storage.session 経由で新しいウィンドウに引き継ぐ
const isWindow = new URLSearchParams(location.search).has("window");
if (isWindow) document.body.classList.add("window");
$("open-window").addEventListener("click", async () => {
  try {
    const handoff: WindowHandoff = {
      markdown: markdownEl.value,
      title: titleEl.value,
      hashtags: hashtagsEl.value,
      magazine: magazineEl.value,
      price: priceEl.value,
      baseUrl,
      mdName: pickedMdName,
      fieldsEdited: { ...fieldsEdited },
      ...(rewriteTarget ? { rewriteTabId: rewriteTarget.tabId } : {}),
    };
    const img = thumbnailEl.files?.[0];
    if (img && img.size <= HANDOFF_IMAGE_MAX_BYTES) handoff.thumbnail = await fileToPayload(img);
    else if (img) handoff.skippedImageName = img.name; // 大きすぎる画像は渡さず、新しい側で再選択を案内する
    await chrome.storage.session.set({ [STORAGE.windowHandoff]: handoff });
    // 新しいウィンドウにフォーカスが移った時点で、ツールバーのポップアップは Chrome 側が閉じる
    await chrome.windows.create({ url: chrome.runtime.getURL("popup.html?window=1"), type: "popup", width: 520, height: 760 });
    window.close();
  } catch (e) {
    setStatus((e as Error).message, { error: true, near: "window" });
  }
});
/** storage.session の上限(10 MB)に収めるため、画像はこのサイズまで引き継ぐ */
const HANDOFF_IMAGE_MAX_BYTES = 6 * 1024 * 1024;

const markdownEl = $<HTMLTextAreaElement>("markdown");
const titleEl = $<HTMLInputElement>("title");
const hashtagsEl = $<HTMLInputElement>("hashtags");
const magazineEl = $<HTMLInputElement>("magazine");
const priceEl = $<HTMLInputElement>("price");
const thumbnailEl = $<HTMLInputElement>("thumbnail");
const githubUrlEl = $<HTMLInputElement>("github-url");
const markdownFileEl = $<HTMLInputElement>("markdown-file");
const markdownBoxEl = $<HTMLDivElement>("markdown-box");
const submitEl = $<HTMLButtonElement>("submit");
const skipReviewEl = $<HTMLInputElement>("skip-review");
const insertTocEl = $<HTMLInputElement>("insert-toc");
const creditLinkEl = $<HTMLInputElement>("credit-link");

/** 手元の md と一緒にドロップされた、本文の画像(md に ![説明](ファイル名) で書いてあるもの) */
let bodyImageFiles: File[] = [];
/** 記事のフォルダ・ZIP のとき、本文に書いた参照先(相対パス)ごとの画像 */
let bodyImagesBySrc = new Map<string, File>();
let baseUrl: string | undefined; // GitHub から読んだ場合の、相対 thumbnail の基準
/** ポップアップを開いたときに読めた、ログイン中のアカウント(#106)。この画面に出すためだけに持つ(保存しない) */
let loggedInAccount: CurrentUser | null = null;
/** 読み込んだ記事の front matter の note_account(#102)。無ければ undefined */
let articleNoteAccount: string | undefined;

// 「ウィンドウで開く」から来た場合は、元のポップアップの入力状態を復元する(受け取ったら消す)
if (isWindow) {
  chrome.storage.session.get(STORAGE.windowHandoff).then(async (s) => {
    const h = s[STORAGE.windowHandoff] as WindowHandoff | undefined;
    if (!h) return;
    await chrome.storage.session.remove(STORAGE.windowHandoff);
    markdownEl.value = h.markdown;
    if (h.markdown) {
      markdownBoxEl.hidden = false;
      fieldsEl.hidden = false;
    }
    titleEl.value = h.title;
    hashtagsEl.value = h.hashtags;
    magazineEl.value = h.magazine;
    priceEl.value = h.price ?? "";
    renderFieldsSummary();
    baseUrl = h.baseUrl;
    pickedMdName = h.mdName ?? "";
    if (h.fieldsEdited) Object.assign(fieldsEdited, { price: false, ...h.fieldsEdited });
    if (h.thumbnail) setThumbnailFile(payloadToFile(h.thumbnail));
    renderPicked();
    // 引き継いだ md の note_account も読み直す(fillFieldsFromMarkdown は呼ばない。直した欄を上書きしないため)
    articleNoteAccount = readNoteAccount(h.markdown);
    renderAccountTarget();
    if (h.rewriteTabId !== undefined) void refreshRewriteTarget(h.rewriteTabId);
    if (h.skippedImageName) {
      setStatus(`入力途中の内容を引き継ぎましたが、見出し画像「${h.skippedImageName}」は大きいので渡せませんでした。もう一度ドロップするか「画像を選ぶ」で選んでください。`, { error: true, near: "drop" });
    } else if (h.markdown || h.thumbnail) {
      setStatus("入力途中の内容を引き継ぎました。", { near: "drop" });
    }
  });
}

/**
 * 知らせを出す場所。押したボタン(操作した所)のすぐそばに出す(#141)。
 * 「note の下書きを作成」の知らせは、今までどおり #status(ボタンのすぐ下)
 */
const STATUS_IDS = {
  submit: "status",
  window: "status-window",
  drop: "status-drop",
  github: "status-github",
  diagnose: "status-diagnose",
  settings: "status-settings",
  advanced: "status-advanced",
  extraSiteOffer: "status-extra-site-offer",
  extraSiteToggle: "status-extra-site-toggle",
} as const;
type StatusPlace = keyof typeof STATUS_IDS;

/** 知らせを near の場所に出す。同時に出すのは 1 か所だけ(前の知らせは消す) */
function setStatus(msg: string, { error = false, near }: { error?: boolean; near: StatusPlace }) {
  for (const [place, id] of Object.entries(STATUS_IDS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (place !== near) {
      el.hidden = true;
      el.textContent = "";
      el.removeAttribute("role");
      continue;
    }
    el.hidden = false;
    // 読み上げにも届くように、エラーは alert、それ以外は status
    el.setAttribute("role", error ? "alert" : "status");
    // 可読性のため、一文ごとに改行して出す(CSS の white-space: pre-line で改行を効かせる)
    el.textContent = msg.replace(/。(?=.)/g, "。\n");
    el.classList.toggle("error", error);
  }
}

// 設定の読み書き
chrome.storage.local.get([STORAGE.selectorsUrl, STORAGE.githubToken, STORAGE.advancedMode, STORAGE.skipBodyReview, STORAGE.insertToc, STORAGE.embedUrls, STORAGE.insertImages, STORAGE.creditLink]).then((s) => {
  $<HTMLInputElement>("selectors-url").value = (s[STORAGE.selectorsUrl] as string | undefined) ?? "";
  $<HTMLInputElement>("github-token").value = (s[STORAGE.githubToken] as string | undefined) ?? "";
  applyAdvanced(Boolean(s[STORAGE.advancedMode]));
  skipReviewEl.checked = Boolean(s[STORAGE.skipBodyReview]);
  // 目次・埋め込み・本文の画像は、一度も触っていなければ(undefined)入れる。外した人は外したまま
  insertTocEl.checked = s[STORAGE.insertToc] === undefined ? true : Boolean(s[STORAGE.insertToc]);
  // 最後のリンクと #LastOneClick は、既定で入れる(何が入るかはチェックの文言に書いてある)。外した人は外したまま
  creditLinkEl.checked = s[STORAGE.creditLink] === undefined ? true : Boolean(s[STORAGE.creditLink]);
  showArticleOptions();
});
// 「記事の設定」はたたんでおき、見出しの横にオンになっているものを出す
function showArticleOptions() {
  $("article-options-on").textContent = articleOptionsLabel({
    toc: insertTocEl.checked,
    skipReview: skipReviewEl.checked,
  });
}
for (const el of [insertTocEl, skipReviewEl]) el.addEventListener("change", showArticleOptions);
// 「本文の確認を飛ばして、公開設定まで進む」は次回も同じにする
skipReviewEl.addEventListener("change", () => chrome.storage.local.set({ [STORAGE.skipBodyReview]: skipReviewEl.checked }));
// 「記事の先頭に目次を入れる」も次回も同じにする
insertTocEl.addEventListener("change", () => chrome.storage.local.set({ [STORAGE.insertToc]: insertTocEl.checked }));
// 「記事の最後に『Last One Click で下書きしました』のリンクを入れる」も次回も同じにする
creditLinkEl.addEventListener("change", () => chrome.storage.local.set({ [STORAGE.creditLink]: creditLinkEl.checked }));

// 追加の対応先(library.libecity.com)。そのサイトのページ(エディタ以外でも)を開いてツールバーのアイコンを押した人にだけ案内を出し、
// 「使えるようにする」を押したときに任意の権限を求める。許可が無い人(note だけを使う人)には何も出さない
const extraSiteOfferEl = $<HTMLDivElement>("extra-site-offer");
/** 案内の種類(エディタか、それ以外の追加の対応先のページか)。許可したあとの知らせの文を変える */
let extraSiteOffer: ExtraSiteOffer = null;
const extraSiteRowEl = $<HTMLLabelElement>("extra-site-row");
const extraSiteToggleEl = $<HTMLInputElement>("extra-site-toggle");
/** 下書きを入れる追加の対応先のタブ(今のタブがその編集画面のときだけ。それ以外は note のタブを開く) */
let extraSiteFillTabId: number | undefined;
const noteSubmitText = submitEl.textContent ?? "";
/**
 * 入れる先(このタブか、新しい note のタブか)とボタンの文字を決め直す。開いたときと、許可が変わったとき(#120)。
 * 許可があり、今のタブがその編集画面なら、新しいタブを開かずにこのタブに入れる
 */
function refreshExtraSiteFillTarget() {
  if (!EXTRA_SITE_ENABLED || isWindow) return;
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(async ([tab]) => ((await shouldFillExtraSite(chromeExtraSiteApi, tab)) ? tab?.id : undefined))
    .catch(() => undefined)
    .then((id) => {
      extraSiteFillTabId = id;
      applyDestination();
    });
}

/**
 * 書き換える note の記事(#174)。今のタブが、すでにある記事の編集画面(/notes/<ID>/edit)のときだけ。
 * そのときは主のボタンを「この記事を書き換える」にし、「新しい下書きとして作る」も出す
 */
let rewriteTarget: { tabId: number; key: string; title: string } | undefined;
const REWRITE_SUBMIT_LABEL = "この記事を書き換える";
const submitNewEl = $<HTMLButtonElement>("submit-new");
const submitHintEl = $("submit-hint");
const noteSubmitHint = submitHintEl.innerHTML;
/**
 * 書き換える記事を決め直す。ツールバーのポップアップは今のタブ、ウィンドウで開いたときは引き継いだタブ。
 * タイトルは、そのタブの content script に聞く(読めなければ「(タイトルなし)」)
 */
async function refreshRewriteTarget(tabId?: number) {
  const tab =
    tabId !== undefined
      ? await chrome.tabs.get(tabId).catch(() => undefined)
      : isWindow
        ? undefined
        : (await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []))[0];
  const key = noteEditKey(tab?.url);
  if (!tab?.id || !key) {
    rewriteTarget = undefined;
  } else {
    const res = (await chrome.tabs.sendMessage(tab.id, { type: "noteArticle" } satisfies Message).catch(() => null)) as NoteArticleResponse | null;
    rewriteTarget = { tabId: tab.id, key, title: res?.title ?? "" };
  }
  checkTargetNow();
}
void refreshRewriteTarget();
/** 書き換えになるか(書き換える記事があり、入れる先が note のとき) */
function rewriteMode(): boolean {
  return rewriteTarget !== undefined && destination() === "note";
}
/** md の note_url と、開いている記事が合わないときの知らせ。合えば(または書いていなければ)null */
function noteUrlMismatch(): string | null {
  if (!rewriteMode() || !markdownEl.value.trim()) return null;
  try {
    return noteUrlProblem(checkNoteUrl(parseFrontMatter(markdownEl.value, parseYaml).data.noteUrl, rewriteTarget!.key));
  } catch {
    return null;
  }
}
/** 書き換えの表示(開いている記事の名前・新しい下書きのボタン・ボタンの下の説明)を、今の状態に合わせる */
function renderRewrite() {
  const on = rewriteMode();
  $("rewrite-box").hidden = !on;
  submitNewEl.hidden = !on;
  if (on) {
    $("rewrite-target").textContent = `今開いている記事:『${rewriteTarget!.title || "(タイトルなし)"}』`;
    submitHintEl.textContent = "今開いているタブに入れて止まります。中身を確かめて、よければ自分で保存してください。";
  } else {
    submitHintEl.innerHTML = noteSubmitHint;
  }
}

/**
 * note にだけある設定(目次・埋め込み・マガジン・価格・最後のクレジット・本文の確認を飛ばして公開設定まで進む)。
 * 入れる先が追加の対応先の編集画面のときは押せなくし、「(このページでは使えません)」を添える。チェックや欄の値は変えない
 */
// 「本文の確認を飛ばして、公開設定まで進む」は、note の本文と公開設定が別の画面だからある設定。
// 追加の対応先は記事の設定も 1 回で入れて止まるので、使わない(値も渡していない)
const NOTE_ONLY_CONTROLS = [insertTocEl, creditLinkEl, magazineEl, priceEl, skipReviewEl];
const UNAVAILABLE_NOTE = "(このページでは使えません)";
/** 追加の対応先の許可があるか(開発用のビルドだけ。showExtraSiteSetting で決まる) */
let extraSiteGranted = false;
/** 追加の対応先のアカウントを出せたか(読めたときだけ true) */
let extraSiteAccountShown = false;
let extraSiteAccountAsked = false;
/**
 * 新しいタブで追加の対応先の新規記事を開いて入れるか。今のタブが編集画面でなく、許可があり、
 * 記事の target が note 以外のとき(note と同じく、別のページからも作れるように)
 */
function extraSiteNewMode(): boolean {
  if (!EXTRA_SITE_ENABLED || !extraSiteGranted || extraSiteFillTabId !== undefined || !markdownEl.value.trim()) return false;
  try {
    const t = parseFrontMatter(markdownEl.value, parseYaml).data.target?.trim();
    return !!t && t.toLowerCase() !== "note";
  } catch {
    return false;
  }
}
/** 入れる先。今のタブが追加の対応先の編集画面か、記事の target が note 以外で許可があれば extra-site */
function destination(): Destination {
  return extraSiteFillTabId !== undefined || extraSiteNewMode() ? "extra-site" : "note";
}
/** ボタンの文字を、入れる先に合わせる */
function submitTextFor(): string {
  if (extraSiteFillTabId !== undefined) return EXTRA_SITE_SUBMIT_LABEL;
  if (rewriteMode()) return REWRITE_SUBMIT_LABEL;
  return extraSiteNewMode() ? EXTRA_SITE_NEW_SUBMIT_LABEL : noteSubmitText;
}
/** 前に出した「target が合わない」の知らせ。合うようになったら、この知らせだけ消す */
let targetProblemShown: string | null = null;
let submitting = false;
/** 入れる先に合わせて、note にだけある設定の押せる・押せないと、target の確かめを今の状態にする */
function applyDestination() {
  checkTargetNow();
}
/**
 * 入れる先に合わせて、ボタンの文字・note にだけある設定の押せる・押せない・note のアカウントの表示を合わせる。
 * 入れる先は記事の target でも変わる(新しいタブで追加の対応先を開くとき)ので、記事を読むたびに checkTargetNow から呼ぶ
 */
function applyDestinationControls() {
  submitEl.textContent = submitTextFor();
  const toExtraSite = destination() === "extra-site";
  for (const el of NOTE_ONLY_CONTROLS) {
    el.disabled = toExtraSite;
    const label = el.closest("label");
    if (!label) continue;
    label.classList.toggle("unavailable", toExtraSite);
    let note = label.querySelector<HTMLSpanElement>(".unavailable-note");
    if (toExtraSite && !note) {
      note = document.createElement("span");
      note.className = "unavailable-note";
      note.textContent = UNAVAILABLE_NOTE;
      label.append(note);
    }
    if (note) note.hidden = !toExtraSite;
  }
  // 書き換えでは、本文の確認を飛ばして公開設定まで進めない(公開設定の画面に移ると記事が保存される可能性があるため。#174)
  if (!toExtraSite) {
    const rewriting = rewriteMode();
    skipReviewEl.disabled = rewriting;
    const label = skipReviewEl.closest("label");
    if (label) {
      label.classList.toggle("unavailable", rewriting);
      let note = label.querySelector<HTMLSpanElement>(".rewrite-note");
      if (rewriting && !note) {
        note = document.createElement("span");
        note.className = "unavailable-note rewrite-note";
        note.textContent = "(書き換えでは使えません)";
        label.append(note);
      }
      if (note) note.hidden = !rewriting;
    }
  }
  renderRewrite();
  // ログイン中のアカウントは、入れる先にかかわらず、読めたものを「(ドメイン): [アイコン] 名前」で並べて出す
  // (ドメインを見出しにするので、どのサイトのアカウントかを取り違えない)。記事の指定(note_account)は note に入れるときだけ
  // ② の一覧も、入れる先に合わせて出し直す(入れる先は、開いたあとで決まることがある)
  renderFieldsSummary();
  $("account").hidden = !loggedInAccount;
  $("extra-site-account").hidden = !extraSiteAccountShown;
  renderAccountTarget();
}
/**
 * 記事の target が入れる先と合わなければ、読み込んだ時点で知らせてボタンを止める(押してから止めるより先に分かる)。
 * 知らせは、押せなくした「note の下書きを作成」のすぐ下(#status)に出す。押せない理由がボタンのそばで分かるように
 */
function checkTargetNow() {
  if (submitting) return;
  applyDestinationControls();
  const problem = markdownEl.value.trim() ? (targetProblem(markdownEl.value, destination(), parseYaml) ?? noteUrlMismatch()) : null;
  submitEl.disabled = problem !== null;
  const submitStatusEl = document.getElementById(STATUS_IDS.submit);
  if (problem) {
    setStatus(problem, { error: true, near: "submit" });
    targetProblemShown = problem;
  } else if (submitStatusEl && targetProblemShown !== null && submitStatusEl.textContent === targetProblemShown.replace(/。(?=.)/g, "。\n")) {
    submitStatusEl.hidden = true;
    submitStatusEl.textContent = "";
    submitStatusEl.removeAttribute("role");
    targetProblemShown = null;
  }
}
/** アカウントの 1 行の中身: 「(ドメイン):」と、[アイコン] 名前 (@ID)。アイコンは https のときだけ */
function accountRow(host: string, iconUrl: unknown, name?: string, suffix?: string): Node[] {
  const label = document.createElement("span");
  label.className = "host";
  label.textContent = `${host}:`;
  const who = document.createElement("span");
  who.className = "who";
  if (typeof iconUrl === "string" && iconUrl.startsWith("https://")) {
    const img = document.createElement("img");
    img.src = iconUrl;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    who.append(img);
  }
  if (name) {
    const b = document.createElement("b");
    b.textContent = name;
    who.append(b);
  }
  if (suffix) who.append(document.createTextNode(suffix));
  return [label, who];
}
/**
 * 追加の対応先のログイン中のアカウントを、「(ドメイン): [アイコン] 名前」と出す。
 * 開いている追加の対応先のタブ(今のタブを先に。無ければ最近見たタブ)の content script に 1 回だけ聞く。
 * 名前はマイページの左の欄にだけあるので、開いているページに無ければ、そのタブがマイページを 1 回だけ GET で読む
 * (extension/src/lib/extra-site-account.ts)。タブが無いか読めなければ何も出さない。読んだものは保存しない
 */
async function showExtraSiteAccount(): Promise<void> {
  if (!EXTRA_SITE_ENABLED || extraSiteAccountAsked) return;
  extraSiteAccountAsked = true;
  const [current] = isWindow ? [] : await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const tabs = await chrome.tabs.query({ url: EXTRA_SITE_ORIGIN }).catch(() => []);
  const tabId = pickExtraSiteTab(current, tabs);
  if (tabId === undefined) return;
  const res = (await chrome.tabs.sendMessage(tabId, { type: "extraSiteAccount" } satisfies Message).catch(() => null)) as ExtraSiteAccountResponse | null;
  const account = res?.account;
  if (!account || (!account.name && !account.iconUrl)) return;
  const el = $<HTMLParagraphElement>("extra-site-account");
  el.replaceChildren(...accountRow(EXTRA_SITE_HOST, account.iconUrl, account.name));
  el.title = `お使いの Chrome で ${EXTRA_SITE_HOST} にログインしているアカウントです。違っていたら、${EXTRA_SITE_HOST} でログインし直してから入れてください。`;
  extraSiteAccountShown = true;
  applyDestination();
}
function showExtraSiteSetting(granted: boolean) {
  extraSiteGranted = granted;
  if (granted) void showExtraSiteAccount();
  applyDestination();
  extraSiteRowEl.hidden = !granted;
  extraSiteToggleEl.checked = granted;
  if (granted) extraSiteOfferEl.hidden = true;
}
// 実機で下書きの入力を確かめるまでは、ふつうのビルドでは入口を出さない(EXTRA_SITE_ENABLED。shared/extra-site.ts)
if (EXTRA_SITE_ENABLED) {
  chromeExtraSiteApi.hasPermission().then(showExtraSiteSetting, () => showExtraSiteSetting(false));
  // 別ウィンドウで開いたときは、今のウィンドウ = この画面なので、ページは見ない
  if (!isWindow) {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(async ([tab]) => {
        extraSiteOffer = await shouldOfferExtraSite(chromeExtraSiteApi, tab);
        $("extra-site-offer-editor").hidden = extraSiteOffer !== "editor";
        $("extra-site-offer-site").hidden = extraSiteOffer !== "site";
        extraSiteOfferEl.hidden = extraSiteOffer === null;
      })
      .catch(() => {
        extraSiteOfferEl.hidden = true;
      });
    refreshExtraSiteFillTarget();
  }
  $("extra-site-enable").addEventListener("click", () => {
    // 許可を求める呼び出しは、クリックの中で(await より前に)行う
    enableExtraSite(chromeExtraSiteApi)
      .then((granted) => {
        if (!granted) return;
        showExtraSiteSetting(true);
        refreshExtraSiteFillTarget();
        extraSiteOfferEl.hidden = true;
        setStatus(
          (extraSiteOffer === "editor"
            ? "今開いているサイト(library.libecity.com)でも使えるようにしました。下書きを入れる前に、今開いているページを再読み込みしてください。"
            : "今開いているサイト(library.libecity.com)でも使えるようにしました。新規記事エディタを開いてから、もう一度ツールバーのアイコンを押してください。") +
            "切るときは「記事の設定」の「追加の対応先(library.libecity.com)」を外してください。",
          { near: "extraSiteOffer" },
        );
      })
      .catch((e) => setStatus((e as Error).message, { error: true, near: "extraSiteOffer" }));
  });
  extraSiteToggleEl.addEventListener("change", () => {
    if (extraSiteToggleEl.checked) return; // 入れ直しは、そのサイトのページで「使えるようにする」から
    disableExtraSite(chromeExtraSiteApi)
      .then((granted) => {
        showExtraSiteSetting(granted);
        refreshExtraSiteFillTarget();
        if (!granted) setStatus("追加の対応先(library.libecity.com)への許可を外しました。", { near: "extraSiteToggle" });
      })
      .catch((e) => setStatus((e as Error).message, { error: true, near: "extraSiteToggle" }));
  });
  // Chrome の画面(拡張機能の詳細・サイトへのアクセス)から許可を変えられたときも、表示と登録を合わせる
  const onExtraSitePermissionChanged = () => {
    syncExtraSite(chromeExtraSiteApi).then(showExtraSiteSetting, () => {});
    refreshExtraSiteFillTarget();
  };
  chrome.permissions.onRemoved.addListener(onExtraSitePermissionChanged);
  chrome.permissions.onAdded.addListener(onExtraSitePermissionChanged);
}

// 上級者向け(GitHub から読み込む・貼り付け・selectors の URL・GitHub トークン)は普段は隠す。
// 「拡張機能の設定」のチェックで表示/非表示を切り替え、chrome.storage に覚える
$<HTMLParagraphElement>("version").textContent = `Last One Click v${chrome.runtime.getManifest().version}`;
const advancedToggle = $<HTMLInputElement>("advanced-toggle");
function applyAdvanced(on: boolean) {
  advancedToggle.checked = on;
  $("advanced-github").hidden = !on;
  // 閉じたままだと見落とすので、上級者向けを表示しているときは「GitHub から読み込む」を開いておく
  $<HTMLDetailsElement>("github-fold").open = on;
  $("advanced-settings").hidden = !on;
  // 上級者向けでは textarea を編集(貼り付け)できる。普段はファイルの中身の確認用
  markdownEl.readOnly = !on;
  markdownBoxEl.hidden = !on && !markdownEl.value;
  // 上級者向けでは貼り付けに使うので、「読み込んだ md を見る」を開いておく。普段はたたむ(確認のためだけの欄なので)
  $<HTMLDetailsElement>("markdown-fold").open = on;
  $("markdown-note").textContent = on ? "(編集・貼り付け可)" : "(確認用)";
}
advancedToggle.addEventListener("change", async () => {
  const next = advancedToggle.checked;
  await chrome.storage.local.set({ [STORAGE.advancedMode]: next });
  applyAdvanced(next);
  setStatus(next ? "GitHub 連携と上級者向けの設定を表示しました。" : "GitHub 連携と上級者向けの設定を隠しました。", { near: "advanced" });
});
$("save-settings").addEventListener("click", async () => {
  // 記事の URL をこの欄に入れる間違いがあったので、保存する前に確かめる(保存はしない)
  const selectorsUrlProblem = checkSelectorsUrl($<HTMLInputElement>("selectors-url").value);
  if (selectorsUrlProblem) {
    setStatus(selectorsUrlProblem, { error: true, near: "settings" });
    return;
  }
  await chrome.storage.local.set({
    [STORAGE.selectorsUrl]: $<HTMLInputElement>("selectors-url").value.trim(),
    [STORAGE.githubToken]: $<HTMLInputElement>("github-token").value.trim(),
  });
  await chrome.storage.local.remove(STORAGE.selectorsCache);
  setStatus("設定を保存しました。", { near: "settings" });
});

// 診断:アクティブなタブ(note)の content script にレポートを作らせてコピーする。
// 開発用のビルドでは、今のタブが追加の対応先のページなら、そちらの content script にレポートを作らせる(#118)
$("diagnose").addEventListener("click", async () => {
  const out = $<HTMLTextAreaElement>("diagnose-out");
  try {
    const extraTab = await findExtraSiteTab();
    if (extraTab && !(await chromeExtraSiteApi.hasPermission())) {
      throw new Error("library.libecity.com では、まだ使えるようにしていません。ツールバーのアイコンを押し、案内の「使えるようにする」を押してから、ページを再読み込みしてください。");
    }
    const tab = extraTab ?? (await findNoteTab());
    if (!tab?.id) throw new Error("note のタブが見つかりません。note のエディタを開いてから押してください。");
    const res = (await chrome.tabs.sendMessage(tab.id, { type: "diagnose" } satisfies Message).catch(() => null)) as
      | DiagnoseResponse
      | null;
    if (!res) {
      throw new Error(extraTab ? "今開いているページを再読み込みしてから、もう一度押してください。" : "note のタブで実行してください(開いたままなら、タブを再読み込みしてから)。");
    }
    if (!res.ok) throw new Error(res.error);
    out.value = res.report;
    $<HTMLButtonElement>("diagnose-copy").disabled = false;
    // 取得と同時にコピーも試す(別ウィンドウ等でクリップボードが使えないことがあるので、失敗しても結果は欄に残す)
    const copied = await navigator.clipboard.writeText(res.report).then(() => true, () => false);
    if (copied) showCopied();
    setStatus(copied ? "診断結果を取得してコピーしました。そのまま貼り付けて共有してください。" : "診断結果を取得しました。「コピー」を押すか、欄の中を選んでコピーしてください。", { near: "diagnose" });
  } catch (e) {
    setStatus((e as Error).message, { error: true, near: "diagnose" });
  }
});
$("diagnose-copy").addEventListener("click", async () => {
  const out = $<HTMLTextAreaElement>("diagnose-out");
  if (!out.value) return;
  const copied = await navigator.clipboard.writeText(out.value).then(() => true, () => false);
  if (copied) showCopied();
  else {
    out.focus();
    out.select();
  }
  setStatus(copied ? "診断結果をコピーしました。" : "クリップボードに書けなかったので、欄の中を選択しました。Cmd+C でコピーしてください。", { error: !copied, near: "diagnose" });
});

/**
 * コピーできたことを、「コピー」ボタンの上でも見せる(案内の文は、診断のボタンのすぐ下に出る)。
 * 少したつと元の「コピー」に戻す
 */
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
function showCopied() {
  const button = $<HTMLButtonElement>("diagnose-copy");
  clearTimeout(copiedTimer);
  button.textContent = "コピーしました ✓";
  button.classList.add("copied");
  copiedTimer = setTimeout(() => {
    button.textContent = "コピー";
    button.classList.remove("copied");
  }, 2000);
}

/**
 * 診断の相手にする追加の対応先のタブ。開発用のビルドで、ツールバーのポップアップの今のタブがそのページのときだけ。
 * (独立したウィンドウでは今のタブ = この画面なので、見ない)
 */
async function findExtraSiteTab(): Promise<chrome.tabs.Tab | undefined> {
  if (!EXTRA_SITE_ENABLED || isWindow) return undefined;
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  return current?.id !== undefined && isExtraSiteUrl(current.url) ? current : undefined;
}

/** 診断の相手にする note のタブ。アクティブなものを優先し、無ければ最後に見たもの(URL の照合は host_permissions の範囲) */
async function findNoteTab(): Promise<chrome.tabs.Tab | undefined> {
  const NOTE = ["https://note.com/*", "https://editor.note.com/*"];
  // ツールバーのポップアップなら、今のウィンドウでアクティブな note のタブ(= 見ているエディタ)
  const [current] = await chrome.tabs.query({ url: NOTE, active: true, currentWindow: true });
  if (current) return current;
  // 独立ウィンドウなどで該当しなければ、最後に見た note のタブ
  const tabs = await chrome.tabs.query({ url: NOTE });
  return tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

/**
 * ログイン中の note アカウントを、「note の下書きを作成」の近くに出す(#106)。
 * 開いている note のタブがあれば、そのタブの content script に 1 回だけ聞く。
 * タブが無いとき(またはタブから返事が無いとき)だけ、service worker が note.com に 1 回問い合わせる(#127)。
 * 拡張は Cookie を読まない(ログインの状態はブラウザが付ける)。
 * 読めなければ何も出さない。名前・ID・アイコンの URL は画面に出すだけで、保存しない
 */
async function showAccount(): Promise<void> {
  const account = await loadPopupAccount({
    findNoteTab: async () => (await findNoteTab())?.id,
    askTab: (tabId) => chrome.tabs.sendMessage(tabId, { type: "account" } satisfies Message) as Promise<AccountResponse | null>,
    askBackground: () => chrome.runtime.sendMessage({ type: "account" } satisfies Message) as Promise<AccountResponse | null>,
  });
  if (!account) return;
  loggedInAccount = account;
  renderAccountTarget();
  const el = $<HTMLParagraphElement>("account");
  el.replaceChildren(...accountRow("note.com", account.iconUrl, account.name, account.id && account.id !== account.name ? `(@${account.id})` : undefined));
  el.title = "お使いの Chrome で note にログインしているアカウントです。違っていたら、note でアカウントを切り替えてから作成してください。";
  el.hidden = false;
}
void showAccount();

/** md の front matter の note_account。無いか読めなければ undefined */
function readNoteAccount(md: string): string | undefined {
  try {
    return parseFrontMatter(md, parseYaml).data.noteAccount;
  } catch {
    return undefined;
  }
}

/**
 * 記事が note_account を指定していれば、「記事の指定: ◯◯」を「note の下書きを作成」の近くに出す(#102)。
 * ログイン中のアカウントが読めていて違うときは、注意に変える。ボタンは押せるままにする(止めるかどうかは、
 * note のタブの content script が工程を始める前に比べて決める)
 */
function renderAccountTarget(): void {
  const el = $<HTMLParagraphElement>("account-target");
  const want = articleNoteAccount;
  const id = loggedInAccount?.id;
  const mismatch = Boolean(want && id && !sameNoteAccount(id, want));
  el.hidden = !want || destination() === "extra-site";
  el.classList.toggle("mismatch", mismatch);
  el.textContent = !want
    ? ""
    : mismatch
      ? `⚠️ ログイン中のアカウント(${id})が、記事の指定(${want})と違います。note でアカウントを切り替えてから作成してください。`
      : `記事の指定: ${want}`;
}

// GitHub から md を読み込んで textarea に入れる
$("github-load").addEventListener("click", async () => {
  try {
    setStatus("GitHub から取得中...", { near: "github" });
    const r = await fetchMarkdownFromGitHub(githubUrlEl.value.trim());
    markdownEl.value = r.markdown;
    forgetSource(); // 手元の md と一緒にドロップした本文の画像は、GitHub の記事には使わない
    baseUrl = r.baseUrl;
    fillFieldsFromMarkdown(r.markdown, { newSource: true });
    setStatus(`読み込みました。内容を確認して「${submitLabel()}」を押してください。`, { near: "github" });
    checkTargetNow(); // target が入れる先と合わなければ、読み込みの知らせより先にこちらを出す
  } catch (e) {
    setStatus((e as Error).message, { error: true, near: "github" });
  }
});
// GitHub から読んだ記事を少し直しても、見出し画像・本文の画像は同じフォルダから取る(baseUrl を残す)。
// 欄を空にしたときと、全体を貼り替えたとき(別の記事にしたとき)だけ、前の記事の取得元と本文の画像を外す
function forgetSource() {
  baseUrl = undefined;
  bodyImageFiles = [];
  bodyImagesBySrc = new Map();
  pickedMdName = "";
  renderPicked();
}
markdownEl.addEventListener("paste", () => {
  if (markdownEl.selectionStart === 0 && markdownEl.selectionEnd === markdownEl.value.length) forgetSource();
});
markdownEl.addEventListener("input", () => {
  if (!markdownEl.value.trim()) forgetSource();
  checkTargetNow();
});
markdownEl.addEventListener("change", () => {
  // 上級者向けの貼り付け・編集後(フォーカスが外れたとき)。ユーザーが直した欄は上書きしない
  if (markdownEl.value.trim()) fillFieldsFromMarkdown(markdownEl.value, { newSource: false });
});

// 手元の md ファイルを読み込む(ファイル選択、または textarea へのドロップ)。
// 相対パスの thumbnail はブラウザからは辿れないので、見出し画像はポップアップで選んでもらう
const MAX_MD_BYTES = 2 * 1024 * 1024;
async function loadMarkdownFile(file: File) {
  if (file.size > MAX_MD_BYTES) throw new Error(`ファイルが大きすぎます(${Math.round(file.size / 1024)} KB)。2 MB 以下の md ファイルを選んでください。`);
  const text = await file.text();
  if (text.includes("\u0000")) throw new Error("テキストのファイル(.md)を選んでください。");
  markdownEl.value = text;
  markdownBoxEl.hidden = false;
  baseUrl = undefined;
  bodyImagesBySrc = new Map();
  bodyImageFiles = []; // 本文の画像は、この md と一緒に(またはあとから)ドロップしたものだけを使う
  pickedMdName = file.name;
  renderPicked();
  markdownFileEl.value = ""; // 同じファイルをもう一度選んでも change が出るように
  const fm = text.split(/^---\s*$/m)[1] ?? "";
  const hasThumbnail = /^thumbnail:/m.test(fm);
  const { titleMissing } = fillFieldsFromMarkdown(text, { newSource: true });
  setStatus(
    `${file.name} を読み込みました。` +
      (titleMissing ? "md ファイルにタイトルが無いので「タイトル」に入力してください。" : `内容を確認して「${submitLabel()}」を押してください。`) +
      (hasThumbnail ? "\n見出し画像はファイルからは辿れないので、ドロップするか「画像を選ぶ」で画像を選んでください。" : ""),
    { error: titleMissing, near: "drop" },
  );
  checkTargetNow(); // target が入れる先と合わなければ、読み込みの知らせより先にこちらを出す
  if (titleMissing) {
    fieldsEditEl.open = true;
    titleEl.focus();
  }
}
markdownFileEl.addEventListener("change", async () => {
  const file = markdownFileEl.files?.[0];
  if (!file) return;
  try {
    if (isZip(file)) await loadBundle(await zipItems(file), file.name);
    else await loadMarkdownFile(file);
  } catch (e) {
    setStatus((e as Error).message, { error: true, near: "drop" });
  }
});
// ポップアップのどこにドロップしても md として読む(テキストのドロップは既定の挙動に任せる)
document.body.addEventListener("dragover", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  document.body.classList.add("dropping");
});
document.body.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) document.body.classList.remove("dropping");
});
document.body.addEventListener("drop", async (e) => {
  document.body.classList.remove("dropping");
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length === 0) return;
  e.preventDefault();
  // フォルダは webkitGetAsEntry でたどる。ドロップのイベントを抜けると読めなくなるので、await の前に取っておく
  const entries = Array.from(e.dataTransfer?.items ?? [])
    .map((i) => i.webkitGetAsEntry?.())
    .filter((x): x is FileSystemEntry => !!x);
  try {
    if (entries.some((x) => x.isDirectory)) {
      const items = await collectFolderFiles<File>(entries as unknown as Array<FsFileEntry<File> | FsDirEntry<File>>, isBundleFile, MAX_ZIP_ENTRIES);
      await loadBundle(items, entries.filter((x) => x.isDirectory).map((x) => x.name).join(", ") + " フォルダ");
      return;
    }
    if (files.length === 1 && isZip(files[0])) {
      await loadBundle(await zipItems(files[0]), files[0].name);
      return;
    }
    await loadLooseFiles(files);
  } catch (err) {
    setStatus((err as Error).message, { error: true, near: "drop" });
  }
});

/** md と画像を、ばらばらにドロップしたとき。md の本文に ![説明](ファイル名) で書いてある画像は本文の画像、それ以外の 1 枚は見出し画像にする */
async function loadLooseFiles(files: File[]) {
  const imgs = files.filter((f) => f.type.startsWith("image/"));
  const md = files.find((f) => !f.type.startsWith("image/"));
  const got: string[] = [];
  // md を先に読む
  if (md) {
    await loadMarkdownFile(md);
    got.push(`md ファイル: ${md.name}`);
  }
  const names = localImageNames(markdownEl.value);
  const body = imgs.filter((f) => names.has(f.name.toLowerCase()));
  const thumb = imgs.find((f) => !names.has(f.name.toLowerCase()));
  if (thumb) {
    setThumbnailFile(thumb);
    got.push(`見出し画像: ${thumb.name}`);
  }
  if (body.length) {
    // 同じ名前の画像をもう一度ドロップしたら、新しいほうに置き換える
    bodyImageFiles = [...bodyImageFiles.filter((f) => !body.some((b) => b.name.toLowerCase() === f.name.toLowerCase())), ...body];
    // フォルダ・ZIP で見つけた同じ名前の画像より、あとからドロップしたほうを使う
    for (const [src, f] of bodyImagesBySrc) if (body.some((b) => b.name.toLowerCase() === f.name.toLowerCase())) bodyImagesBySrc.delete(src);
    renderPicked();
    got.push(`本文の画像: ${body.length} 枚`);
  }
  const ignored = files.filter((f) => f !== md && !body.includes(f) && f !== thumb).length;
  if (ignored) got.push(`(ほか ${ignored} 個は使いません)`);
  setStatus(`${got.join(" / ")} を受け取りました。「${submitLabel()}」を押してください。`, { near: "drop" });
  checkTargetNow(); // target が入れる先と合わなければ、受け取りの知らせより先にこちらを出す
}

const MAX_ZIP_FILE_BYTES = 60 * 1024 * 1024;
function isZip(f: File): boolean {
  return /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";
}
/** ZIP の中の md と画像を、File にして返す(path は ZIP の中のパス) */
async function zipItems(zip: File): Promise<Array<{ path: string; file: File }>> {
  if (zip.size > MAX_ZIP_FILE_BYTES) throw new Error(`ZIP ファイルが大きすぎます(${MAX_ZIP_FILE_BYTES / 1024 / 1024}MB まで)。`);
  const entries = await readZip(new Uint8Array(await zip.arrayBuffer()));
  return entries.map((e) => ({ path: e.path, file: new File([e.data as BlobPart], e.path.slice(e.path.lastIndexOf("/") + 1), { type: mimeTypeOf(e.path) }) }));
}

/**
 * 記事のフォルダ・ZIP をまとめて受け取ったとき。記事の md を 1 つ選び、
 * 本文に ![説明](ファイル名) で書いてある画像を本文の画像に、front matter の thumbnail に当たる画像を見出し画像にする
 * (ばらばらのドロップと違い、関係ない画像を見出し画像にはしない)
 */
async function loadBundle(items: Array<{ path: string; file: File }>, label: string) {
  const md = pickArticleMarkdown(items);
  await loadMarkdownFile(md.file);
  pickedMdName = md.path;
  const imgs = items.filter((i) => i !== md && i.file.type.startsWith("image/"));
  // 本文に書いた参照先ごとに、md の場所からの相対パスで探す(別のフォルダの同じ名前の画像と取り違えない)
  const bySrc = new Map<string, File>();
  for (const src of localImageSrcs(markdownEl.value)) {
    const hit = findRelative(imgs, md.path, src);
    if (hit) bySrc.set(src, hit.file);
  }
  const body = [...new Set(bySrc.values())];
  bodyImagesBySrc = bySrc;
  bodyImageFiles = body;
  const got = [`md ファイル: ${md.path}`];
  let thumbName: string | undefined;
  try {
    thumbName = parseFrontMatter(markdownEl.value, parseYaml).data.thumbnail;
  } catch {
    // front matter が読めないときは、組み立て時に同じエラーを案内する
  }
  const thumb = findThumbnail(imgs, md.path, thumbName);
  if (thumb) {
    setThumbnailFile(thumb.file);
    got.push(`見出し画像: ${thumb.file.name}`);
  }
  renderPicked();
  if (body.length) got.push(`本文の画像: ${body.length} 枚`);
  const missingThumb = thumbName && !thumb ? `\nfront matter の見出し画像(${thumbName})が見つかりませんでした。ドロップするか「画像を選ぶ」で選んでください。` : "";
  setStatus(`${label} から ${got.join(" / ")} を受け取りました。「${submitLabel()}」を押してください。${missingThumb}`, { near: "drop" });
  checkTargetNow(); // target が入れる先と合わなければ、受け取りの知らせより先にこちらを出す
}

// 「md ファイルを選ぶ」「画像を選ぶ」は本物の button(キーボードでも押せる)。隠した file input を開く。
// 拡張内の file input でも、クリックは必ず safeClick() を通す(AGENTS.md)
$("pick-md").addEventListener("click", () => safeClick(markdownFileEl, "popup.pickMarkdown"));
$("pick-image").addEventListener("click", () => safeClick(thumbnailEl, "popup.pickImage"));

/**
 * md の front matter(と先頭の # 見出し)から、note に入れるタイトル・ハッシュタグ・マガジン・価格を欄に出す。
 * 欄は普段は隠していて、md を読み込んだときだけ出す。送るのは欄の値(ここで直せる)
 */
const fieldsEl = $<HTMLDivElement>("fields");
const fieldsEditEl = $<HTMLDetailsElement>("fields-edit");
/**
 * 「② 入れる内容を確かめる」の欄は、普段はたたんでおき、入る値を短い一覧で出す(直すときだけ「直す」で開く)。
 * 値が無いものは「なし」。タイトルが無いときは開いて知らせる
 */
function renderFieldsSummary() {
  // マガジン・価格は note にだけある設定。追加の対応先に入れるときは入らないので、一覧でもそう出す(欄と同じ)
  const noteOnly = destination() !== "note";
  const rows: [string, string, boolean][] = [
    ["タイトル", titleEl.value.trim(), false],
    ["ハッシュタグ", hashtagsEl.value.trim(), false],
    ["マガジン", magazineEl.value.trim(), noteOnly],
    ["価格", priceEl.value.trim() ? `${priceEl.value.trim()} 円` : "", noteOnly],
  ];
  const nodes: Node[] = [];
  for (const [label, value, unavailable] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = unavailable
      ? `${value ? `${value} ` : ""}${UNAVAILABLE_NOTE}`
      : value || (label === "タイトル" ? "(ありません。「直す」で入れてください)" : "なし");
    if (!value && label === "タイトル") dd.classList.add("missing");
    if (unavailable) dd.classList.add("unavailable");
    nodes.push(dt, dd);
  }
  $("fields-summary").replaceChildren(...nodes);
}
for (const el of [titleEl, hashtagsEl, magazineEl, priceEl]) el.addEventListener("input", renderFieldsSummary);
/** ユーザーが欄を直したか。直した欄は、本文の再読み取りで上書きしない(新しい md を読み込んだときはリセット) */
const fieldsEdited = { title: false, hashtags: false, magazine: false, price: false };
function fillFieldsFromMarkdown(md: string, opts: { newSource: boolean }): { titleMissing: boolean } {
  let title = "";
  let hashtags: string[] = [];
  let magazine = "";
  let price = "";
  articleNoteAccount = undefined;
  try {
    const { data, content } = parseFrontMatter(md, parseYaml);
    articleNoteAccount = data.noteAccount;
    title = data.title ?? content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
    hashtags = data.hashtags ?? [];
    magazine = data.magazine ?? "";
    // price が正しくないときも、ほかの欄は埋める。価格の欄には書かれていた値を出し、送るときに直し方を出す
    price = data.price ? String(data.price) : (data.priceRaw ?? "");
  } catch {
    // front matter が読めないときは空のまま出す(組み立て時に同じエラーを案内する)
  }
  if (opts.newSource) fieldsEdited.title = fieldsEdited.hashtags = fieldsEdited.magazine = fieldsEdited.price = false;
  if (!fieldsEdited.title) titleEl.value = title;
  if (!fieldsEdited.hashtags) hashtagsEl.value = hashtags.join(", ");
  if (!fieldsEdited.magazine) magazineEl.value = magazine;
  if (!fieldsEdited.price) priceEl.value = price;
  fieldsEl.hidden = false;
  renderFieldsSummary();
  renderAccountTarget();
  checkTargetNow();
  const titleMissing = !titleEl.value.trim();
  titleEl.classList.toggle("missing", titleMissing);
  return { titleMissing };
}
titleEl.addEventListener("input", () => {
  fieldsEdited.title = true;
  titleEl.classList.toggle("missing", !titleEl.value.trim());
});
hashtagsEl.addEventListener("input", () => (fieldsEdited.hashtags = true));
magazineEl.addEventListener("input", () => (fieldsEdited.magazine = true));
priceEl.addEventListener("input", () => (fieldsEdited.price = true));

/** ドロップされた画像を「見出し画像」の input に入れる(ファイル選択と同じ扱いになる) */
function setThumbnailFile(file: File) {
  const dt = new DataTransfer();
  dt.items.add(file);
  thumbnailEl.files = dt.files;
  renderPicked();
}
thumbnailEl.addEventListener("change", renderPicked);

/** ドロップ領域に、受け取り済みのファイル名を出す */
let pickedMdName = "";
function renderPicked() {
  const el = $<HTMLParagraphElement>("picked");
  const parts: string[] = [];
  if (pickedMdName) parts.push(`md ファイル: ${pickedMdName}`);
  const img = thumbnailEl.files?.[0];
  if (img) parts.push(`見出し画像: ${img.name}`);
  if (bodyImageFiles.length) parts.push(`本文の画像: ${bodyImageFiles.length} 枚`);
  el.hidden = parts.length === 0;
  el.textContent = parts.length ? `受け取り済み: ${parts.join(" / ")}` : "";
}

// 本体
submitEl.addEventListener("click", () => void submitArticle(false));
// 書き換えられる記事を開いていても、新しい下書きとして作れるように(#174)
submitNewEl.addEventListener("click", () => void submitArticle(true));

/** 「note の下書きを作成」(書き換えのときは「この記事を書き換える」)。forceNew なら、書き換えずに新しい下書きを作る */
async function submitArticle(forceNew: boolean) {
  if (submitting) return;
  submitEl.disabled = true;
  submitNewEl.disabled = true;
  submitting = true;
  try {
    if (!markdownEl.value.trim()) throw new Error("記事の md ファイルをドロップするか、「md ファイルを選ぶ」で選んでください。");

    setStatus("記事を組み立て中...", { near: "submit" });
    const article = await buildArticle({
      markdown: markdownEl.value,
      thumbnailFile: thumbnailEl.files?.[0] ?? null,
      baseUrl,
      // 欄の値が「送る内容」。空にしたら front matter に戻らず「なし」(final)
      // マガジン・価格は note にだけある設定。追加の対応先に入れるときは押せなくしてあるので、値を渡さず確かめもしない
      override: {
        title: titleEl.value,
        hashtags: hashtagsEl.value,
        magazine: destination() === "note" ? magazineEl.value : "",
        price: destination() === "note" ? priceEl.value : "",
        final: true,
        // 有料の区切りも note にだけある設定。追加の対応先では、印の行を取り除くだけで、価格が無くても止めない
        ignorePaywall: destination() !== "note",
      },
      // 追加の対応先の編集画面には、最後のクレジットは入れない(note にだけある設定。押せなくしてある)
      creditLink: destination() === "note" && creditLinkEl.checked,
      // 本文の画像は、いつも入れる(切るチェックは外した。整理のため)
      insertImages: true,
      bodyImageFiles,
      bodyImagesBySrc,
      // front matter の target と入れる先が合わなければ、ここで止まる(タブを開く前)
      destination: destination(),
    });

    if (extraSiteFillTabId !== undefined) {
      await fillExtraSiteTab(extraSiteFillTabId, article);
      return;
    }
    if (extraSiteNewMode()) {
      await openExtraSiteAndFill(article);
      return;
    }

    if (!forceNew && rewriteMode()) {
      await rewriteNoteTab(rewriteTarget!, article);
      return;
    }

    const { selectors, source, warning } = await loadSelectors();
    // newNoteUrl は loadSelectors の中で note の origin であることを検査済み
    // 先に pending を置き(tabId: null)、タブを開いたら ID を埋める。content script はこの ID のタブでだけ動く
    // タブは非アクティブで作る: アクティブで作るとフォーカスが移ってポップアップが閉じられ、
    // 後続の tabId の書き込みが走らないことがある。ID を保存し終えてからアクティブにする
    const skipBodyReview = skipReviewEl.checked;
    const insertToc = insertTocEl.checked;
    // URL だけの行は、いつも埋め込みにする(切るチェックは外した。整理のため)
    const embedUrls = true;
    await chrome.storage.local.set({ [STORAGE.pendingArticle]: { ...article, tabId: null, skipBodyReview, insertToc, embedUrls } });
    const tab = await chrome.tabs.create({ url: selectors.newNoteUrl, active: false });
    if (tab.id === undefined) {
      await chrome.storage.local.remove(STORAGE.pendingArticle);
      throw new Error("タブを開けませんでした。");
    }
    await chrome.storage.local.set({ [STORAGE.pendingArticle]: { ...article, tabId: tab.id, skipBodyReview, insertToc, embedUrls } });
    await chrome.tabs.update(tab.id, { active: true });

    setStatus(
      `note を開きました。` +
        (skipBodyReview ? "入力が終わったら、「投稿する」を自分で押してください。" : "続きは右下のバナーで案内します。") +
        (source === "remote" ? "" : `\n(selectors: ${source})`) +
        (warning ? `\n注意: GitHub 上の selectors が使えなかったので同梱の値を使っています(${warning})` : ""),
      { error: Boolean(warning), near: "submit" },
    );
  } catch (e) {
    setStatus((e as Error).message, { error: true, near: "submit" });
  } finally {
    submitting = false;
    submitEl.disabled = false;
    submitNewEl.disabled = false;
    checkTargetNow();
  }
}

/**
 * 開いている note の記事の編集画面を、md の内容で書き換える(#174)。新しいタブは開かない。
 * このタブ向けの pending(rewriteKey 付き)を置いて、content script に始めてもらう。入れ終わるのは待たない(結果はページのバナーに出る)。
 * 本文の確認を飛ばして公開設定まで進む、は使わない(公開設定の画面に移ると記事が保存される可能性があるため)
 */
async function rewriteNoteTab(target: { tabId: number; key: string }, article: Awaited<ReturnType<typeof buildArticle>>) {
  const problem = noteUrlProblem(checkNoteUrl(article.noteUrl, target.key));
  if (problem) throw new Error(problem);
  // 押すまでのあいだに、そのタブで別の記事に移っていないか
  const tab = await chrome.tabs.get(target.tabId).catch(() => undefined);
  if (noteEditKey(tab?.url) !== target.key) throw new Error("書き換える記事のタブが、別のページに移っています。記事の編集画面でポップアップを開き直してください。");
  await chrome.storage.local.set({
    [STORAGE.pendingArticle]: { ...article, tabId: target.tabId, rewriteKey: target.key, skipBodyReview: false, insertToc: insertTocEl.checked, embedUrls: true },
  });
  const res = (await chrome.tabs.sendMessage(target.tabId, { type: "noteRewrite" } satisfies Message).catch(() => null)) as NoteRewriteResponse | null;
  if (!res?.ok) {
    await chrome.storage.local.remove(STORAGE.pendingArticle);
    throw new Error(res?.error ?? "今開いている記事のページを再読み込みしてから、もう一度押してください(再読み込みで、まだ保存していない変更は消えます)。");
  }
  if (isWindow) await chrome.tabs.update(target.tabId, { active: true }).catch(() => undefined);
  setStatus(`今開いている記事に書き換えを始めました。続きはページの右下に出ます。\n中身を確かめて、よければ自分で保存してください。\n${REWRITE_UNDO_NOTE}`, { near: "submit" });
}

/**
 * 今開いている追加の対応先の編集画面のタブに、記事を入れる(#120)。新しいタブは開かない。
 * 入れ終わるのは待たない(結果はそのページのバナーに出る)。このページでは入らない書き方は、入れる前にここで知らせる
 */
async function fillExtraSiteTab(tabId: number, article: Awaited<ReturnType<typeof buildArticle>>) {
  const { notes, extraArticle } = extraSiteMessage(article);
  const message: Message = { type: "extraSiteFill", article: extraArticle, notes };
  const res = (await chrome.tabs.sendMessage(tabId, message).catch(() => null)) as ExtraSiteFillResponse | null;
  if (!res) throw new Error("今開いているページを再読み込みしてから、もう一度押してください。");
  if (!res.ok) throw new Error(res.error);
  setStatus(
    "今開いているページに入れ始めました。続きはページの右下に出ます。\n中身を確かめてから、ページの「下書き保存」を自分で押してください。" + notesText(notes),
    { error: notes.length > 0, near: "submit" },
  );
}

/**
 * 新しいタブで追加の対応先の新規記事のエディタを開き、開いたら記事を入れる(note と同じく、別のページからも作れるように)。
 * タブを開くとポップアップは閉じるので、開いて待つのは service worker に頼む。続きはそのページのバナーに出る
 */
async function openExtraSiteAndFill(article: Awaited<ReturnType<typeof buildArticle>>) {
  const { notes, extraArticle } = extraSiteMessage(article);
  // 閉じる前に読めるよう、知らせを先に出しておく
  setStatus(`${EXTRA_SITE_HOST} の新規記事を新しいタブで開いています。続きはそのページの右下に出ます。` + notesText(notes), { error: notes.length > 0, near: "submit" });
  const res = (await chrome.runtime.sendMessage({ type: "extraSiteOpenAndFill", article: extraArticle, notes } satisfies Message).catch(() => null)) as ExtraSiteFillResponse | null;
  if (!res) throw new Error("新しいタブを開けませんでした。もう一度押してください。");
  if (!res.ok) throw new Error(res.error);
}

/** 入らない書き方の知らせの文(無ければ空) */
function notesText(notes: string[]): string {
  return notes.length ? `\n\n${EXTRA_SITE_HOST} のエディタでは入らない書き方:\n${notes.map((n) => `・${n}`).join("\n")}` : "";
}

/** 追加の対応先に渡す記事と、入らない書き方の知らせ */
function extraSiteMessage(article: Awaited<ReturnType<typeof buildArticle>>) {
  // 目次・埋め込み・マガジン・価格は、このページでは押せなくしてあるので知らせない。本文の書き方と画像だけ知らせる
  const notes = extraSiteUnsupportedNotes({
    html: article.html,
    insertToc: false,
    embedUrls: false,
    images: article.images,
  });
  return {
    notes,
    extraArticle: {
      title: article.title,
      hashtags: article.hashtags,
      html: article.html,
      thumbnail: article.thumbnail,
      images: article.images,
      imageNotes: article.imageNotes,
      ...(article.summary !== undefined ? { summary: article.summary } : {}),
      ...(article.category !== undefined ? { category: article.category } : {}),
      ...(article.publishScope ? { publishScope: article.publishScope } : {}),
      ...(article.readingTime !== undefined ? { readingTime: article.readingTime } : {}),
    },
  };
}
