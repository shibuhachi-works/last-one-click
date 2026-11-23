// ポップアップ。入力を ArticlePayload に組み立てて chrome.storage に置き、
// note のエディタを新しいタブで開く。実際の入力は content.ts が行う。
import { parse as parseYaml } from "yaml";
import { parseFrontMatter } from "../../shared/article";
import type { CurrentUser } from "../../shared/current-user";
import { sameNoteAccount } from "../../shared/note-account";
import { checkSelectorsUrl } from "../../shared/selectors-url";
import { articleOptionsLabel } from "../../shared/article-options";
import { collectFolderFiles, findRelative, findThumbnail, mimeTypeOf, pickArticleMarkdown, type FsDirEntry, type FsFileEntry } from "../../shared/bundle";
import { MAX_ZIP_ENTRIES, isBundleFile, readZip } from "../../shared/zip";
import { buildArticle, fetchMarkdownFromGitHub, fileToPayload, localImageNames, localImageSrcs, payloadToFile } from "./lib/article";
import { disableExtraSite, enableExtraSite, shouldOfferExtraSite, syncExtraSite } from "../../shared/extra-site";
import { chromeExtraSiteApi } from "./lib/extra-site";
import { safeClick } from "./lib/safe-click";
import { loadSelectors } from "./lib/selectors";
import { STORAGE, type AccountResponse, type DiagnoseResponse, type Message, type WindowHandoff } from "./lib/types";

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
    };
    const img = thumbnailEl.files?.[0];
    if (img && img.size <= HANDOFF_IMAGE_MAX_BYTES) handoff.thumbnail = await fileToPayload(img);
    else if (img) handoff.skippedImageName = img.name; // 大きすぎる画像は渡さず、新しい側で再選択を案内する
    await chrome.storage.session.set({ [STORAGE.windowHandoff]: handoff });
    // 新しいウィンドウにフォーカスが移った時点で、ツールバーのポップアップは Chrome 側が閉じる
    await chrome.windows.create({ url: chrome.runtime.getURL("popup.html?window=1"), type: "popup", width: 520, height: 760 });
    window.close();
  } catch (e) {
    setStatus((e as Error).message, true);
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
const statusEl = $<HTMLParagraphElement>("status");
const submitEl = $<HTMLButtonElement>("submit");
const skipReviewEl = $<HTMLInputElement>("skip-review");
const insertTocEl = $<HTMLInputElement>("insert-toc");
const embedUrlsEl = $<HTMLInputElement>("embed-urls");
const insertImagesEl = $<HTMLInputElement>("insert-images");
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
    baseUrl = h.baseUrl;
    pickedMdName = h.mdName ?? "";
    if (h.fieldsEdited) Object.assign(fieldsEdited, { price: false, ...h.fieldsEdited });
    if (h.thumbnail) setThumbnailFile(payloadToFile(h.thumbnail));
    renderPicked();
    if (h.skippedImageName) {
      setStatus(`入力途中の内容を引き継ぎましたが、見出し画像「${h.skippedImageName}」は大きいので渡せませんでした。もう一度ドロップするか「画像を選ぶ」で選んでください。`, true);
    } else if (h.markdown || h.thumbnail) {
      setStatus("入力途中の内容を引き継ぎました。");
    }
  });
}

function setStatus(msg: string, isError = false) {
  statusEl.hidden = false;
  // 可読性のため、一文ごとに改行して出す(CSS の white-space: pre-line で改行を効かせる)
  statusEl.textContent = msg.replace(/。(?=.)/g, "。\n");
  statusEl.classList.toggle("error", isError);
}

// 設定の読み書き
chrome.storage.local.get([STORAGE.selectorsUrl, STORAGE.githubToken, STORAGE.advancedMode, STORAGE.skipBodyReview, STORAGE.insertToc, STORAGE.embedUrls, STORAGE.insertImages, STORAGE.creditLink]).then((s) => {
  $<HTMLInputElement>("selectors-url").value = (s[STORAGE.selectorsUrl] as string | undefined) ?? "";
  $<HTMLInputElement>("github-token").value = (s[STORAGE.githubToken] as string | undefined) ?? "";
  applyAdvanced(Boolean(s[STORAGE.advancedMode]));
  skipReviewEl.checked = Boolean(s[STORAGE.skipBodyReview]);
  // 目次・埋め込み・本文の画像は、一度も触っていなければ(undefined)入れる。外した人は外したまま
  insertTocEl.checked = s[STORAGE.insertToc] === undefined ? true : Boolean(s[STORAGE.insertToc]);
  embedUrlsEl.checked = s[STORAGE.embedUrls] === undefined ? true : Boolean(s[STORAGE.embedUrls]);
  insertImagesEl.checked = s[STORAGE.insertImages] === undefined ? true : Boolean(s[STORAGE.insertImages]);
  // 最後のリンクと #LastOneClick は、既定で入れる(何が入るかはチェックの文言に書いてある)。外した人は外したまま
  creditLinkEl.checked = s[STORAGE.creditLink] === undefined ? true : Boolean(s[STORAGE.creditLink]);
  showArticleOptions();
});
// 「記事の設定」はたたんでおき、見出しの横にオンになっているものを出す
function showArticleOptions() {
  $("article-options-on").textContent = articleOptionsLabel({ toc: insertTocEl.checked, embed: embedUrlsEl.checked, images: insertImagesEl.checked });
}
for (const el of [insertTocEl, embedUrlsEl, insertImagesEl]) el.addEventListener("change", showArticleOptions);
// 「本文の確認を飛ばして、公開設定まで進む」は次回も同じにする
skipReviewEl.addEventListener("change", () => chrome.storage.local.set({ [STORAGE.skipBodyReview]: skipReviewEl.checked }));
// 「記事の先頭に目次を入れる」も次回も同じにする
insertTocEl.addEventListener("change", () => chrome.storage.local.set({ [STORAGE.insertToc]: insertTocEl.checked }));
// 「URL だけの行を埋め込みにする」も次回も同じにする
embedUrlsEl.addEventListener("change", () => chrome.storage.local.set({ [STORAGE.embedUrls]: embedUrlsEl.checked }));
// 「本文の画像を入れる」も次回も同じにする
insertImagesEl.addEventListener("change", () => chrome.storage.local.set({ [STORAGE.insertImages]: insertImagesEl.checked }));
// 「記事の最後に『Last One Click で下書きしました』のリンクを入れる」も次回も同じにする
creditLinkEl.addEventListener("change", () => chrome.storage.local.set({ [STORAGE.creditLink]: creditLinkEl.checked }));

// 追加の対応先(library.libecity.com)。そのサイトのエディタを開いてツールバーのアイコンを押した人にだけ案内を出し、
// 「使えるようにする」を押したときに任意の権限を求める。許可が無い人(note だけを使う人)には何も出さない
const extraSiteOfferEl = $<HTMLDivElement>("extra-site-offer");
const extraSiteRowEl = $<HTMLLabelElement>("extra-site-row");
const extraSiteToggleEl = $<HTMLInputElement>("extra-site-toggle");
function showExtraSiteSetting(granted: boolean) {
  extraSiteRowEl.hidden = !granted;
  extraSiteToggleEl.checked = granted;
  if (granted) extraSiteOfferEl.hidden = true;
}
chromeExtraSiteApi.hasPermission().then(showExtraSiteSetting, () => showExtraSiteSetting(false));
// 別ウィンドウで開いたときは、今のウィンドウ = この画面なので、ページは見ない
if (!isWindow) {
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]) => shouldOfferExtraSite(chromeExtraSiteApi, tab))
    .then((offer) => {
      extraSiteOfferEl.hidden = !offer;
    })
    .catch(() => {
      extraSiteOfferEl.hidden = true;
    });
}
$("extra-site-enable").addEventListener("click", () => {
  // 許可を求める呼び出しは、クリックの中で(await より前に)行う
  enableExtraSite(chromeExtraSiteApi)
    .then((granted) => {
      if (!granted) return;
      showExtraSiteSetting(true);
      setStatus("このページでも使えるようにしました。切るときは「記事の設定」の「追加の対応先(library.libecity.com)」を外してください。");
    })
    .catch((e) => setStatus((e as Error).message, true));
});
extraSiteToggleEl.addEventListener("change", () => {
  if (extraSiteToggleEl.checked) return; // 入れ直しは、そのサイトのエディタで「使えるようにする」から
  disableExtraSite(chromeExtraSiteApi)
    .then((granted) => {
      showExtraSiteSetting(granted);
      if (!granted) setStatus("追加の対応先(library.libecity.com)への許可を外しました。");
    })
    .catch((e) => setStatus((e as Error).message, true));
});
// Chrome の画面(拡張機能の詳細・サイトへのアクセス)から許可を変えられたときも、表示と登録を合わせる
const onExtraSitePermissionChanged = () => {
  syncExtraSite(chromeExtraSiteApi).then(showExtraSiteSetting, () => {});
};
chrome.permissions.onRemoved.addListener(onExtraSitePermissionChanged);
chrome.permissions.onAdded.addListener(onExtraSitePermissionChanged);

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
  $("markdown-note").textContent = on ? "(編集・貼り付け可)" : "(確認用)";
}
advancedToggle.addEventListener("change", async () => {
  const next = advancedToggle.checked;
  await chrome.storage.local.set({ [STORAGE.advancedMode]: next });
  applyAdvanced(next);
  setStatus(next ? "GitHub 連携と上級者向けの設定を表示しました。" : "GitHub 連携と上級者向けの設定を隠しました。");
});
$("save-settings").addEventListener("click", async () => {
  // 記事の URL をこの欄に入れる間違いがあったので、保存する前に確かめる(保存はしない)
  const selectorsUrlProblem = checkSelectorsUrl($<HTMLInputElement>("selectors-url").value);
  if (selectorsUrlProblem) {
    setStatus(selectorsUrlProblem, true);
    return;
  }
  await chrome.storage.local.set({
    [STORAGE.selectorsUrl]: $<HTMLInputElement>("selectors-url").value.trim(),
    [STORAGE.githubToken]: $<HTMLInputElement>("github-token").value.trim(),
  });
  await chrome.storage.local.remove(STORAGE.selectorsCache);
  setStatus("設定を保存しました。");
});

// 診断:アクティブなタブ(note)の content script にレポートを作らせてコピーする
$("diagnose").addEventListener("click", async () => {
  const out = $<HTMLTextAreaElement>("diagnose-out");
  try {
    const tab = await findNoteTab();
    if (!tab?.id) throw new Error("note のタブが見つかりません。note のエディタを開いてから押してください。");
    const res = (await chrome.tabs.sendMessage(tab.id, { type: "diagnose" } satisfies Message).catch(() => null)) as
      | DiagnoseResponse
      | null;
    if (!res) throw new Error("note のタブで実行してください(開いたままなら、タブを再読み込みしてから)。");
    if (!res.ok) throw new Error(res.error);
    out.value = res.report;
    $<HTMLButtonElement>("diagnose-copy").disabled = false;
    // 取得と同時にコピーも試す(別ウィンドウ等でクリップボードが使えないことがあるので、失敗しても結果は欄に残す)
    const copied = await navigator.clipboard.writeText(res.report).then(() => true, () => false);
    if (copied) showCopied();
    setStatus(copied ? "診断結果を取得してコピーしました。そのまま貼り付けて共有してください。" : "診断結果を取得しました。「コピー」を押すか、欄の中を選んでコピーしてください。");
  } catch (e) {
    setStatus((e as Error).message, true);
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
  setStatus(copied ? "診断結果をコピーしました。" : "クリップボードに書けなかったので、欄の中を選択しました。Cmd+C でコピーしてください。", !copied);
});

/**
 * コピーできたことを、「コピー」ボタンの上で見せる。案内の文(#status)は画面の上のほうにあり、
 * 診断の欄を開いているときは目に入りにくいため。少したつと元の「コピー」に戻す
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
 * 開いている note のタブの content script に 1 回だけ聞く(拡張は Cookie を読まない。問い合わせは note のタブの中で行う)。
 * 読めなければ何も出さない。名前・ID・アイコンの URL は画面に出すだけで、保存しない
 */
async function showAccount(): Promise<void> {
  const tab = await findNoteTab().catch(() => undefined);
  if (tab?.id === undefined) return;
  const res = (await chrome.tabs.sendMessage(tab.id, { type: "account" } satisfies Message).catch(() => null)) as AccountResponse | null;
  const account = res?.account;
  if (!account || typeof account.name !== "string" || !account.name) return;
  loggedInAccount = account;
  renderAccountTarget();
  const el = $<HTMLParagraphElement>("account");
  const nodes: Node[] = [document.createTextNode("ログイン中:")];
  if (typeof account.iconUrl === "string" && account.iconUrl.startsWith("https://")) {
    const img = document.createElement("img");
    img.src = account.iconUrl;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    nodes.push(img);
  }
  const name = document.createElement("b");
  name.textContent = account.name;
  nodes.push(name);
  if (account.id && account.id !== account.name) nodes.push(document.createTextNode(`(@${account.id})`));
  el.replaceChildren(...nodes);
  el.title = "開いている note のタブでログインしているアカウントです。違っていたら、note でアカウントを切り替えてから作成してください。";
  el.hidden = false;
}
void showAccount();

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
  el.hidden = !want;
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
    setStatus("GitHub から取得中...");
    const r = await fetchMarkdownFromGitHub(githubUrlEl.value.trim());
    markdownEl.value = r.markdown;
    forgetSource(); // 手元の md と一緒にドロップした本文の画像は、GitHub の記事には使わない
    baseUrl = r.baseUrl;
    fillFieldsFromMarkdown(r.markdown, { newSource: true });
    setStatus(`読み込みました。内容を確認して「${submitLabel()}」を押してください。`);
  } catch (e) {
    setStatus((e as Error).message, true);
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
    titleMissing,
  );
  if (titleMissing) titleEl.focus();
}
markdownFileEl.addEventListener("change", async () => {
  const file = markdownFileEl.files?.[0];
  if (!file) return;
  try {
    if (isZip(file)) await loadBundle(await zipItems(file), file.name);
    else await loadMarkdownFile(file);
  } catch (e) {
    setStatus((e as Error).message, true);
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
    setStatus((err as Error).message, true);
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
  setStatus(`${got.join(" / ")} を受け取りました。「${submitLabel()}」を押してください。`);
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
  setStatus(`${label} から ${got.join(" / ")} を受け取りました。「${submitLabel()}」を押してください。${missingThumb}`);
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
  renderAccountTarget();
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
submitEl.addEventListener("click", async () => {
  submitEl.disabled = true;
  try {
    if (!markdownEl.value.trim()) throw new Error("記事の md ファイルをドロップするか、「md ファイルを選ぶ」で選んでください。");

    setStatus("記事を組み立て中...");
    const article = await buildArticle({
      markdown: markdownEl.value,
      thumbnailFile: thumbnailEl.files?.[0] ?? null,
      baseUrl,
      // 欄の値が「送る内容」。空にしたら front matter に戻らず「なし」(final)
      override: { title: titleEl.value, hashtags: hashtagsEl.value, magazine: magazineEl.value, price: priceEl.value, final: true },
      creditLink: creditLinkEl.checked,
      insertImages: insertImagesEl.checked,
      bodyImageFiles,
      bodyImagesBySrc,
    });

    const { selectors, source, warning } = await loadSelectors();
    // newNoteUrl は loadSelectors の中で note の origin であることを検査済み
    // 先に pending を置き(tabId: null)、タブを開いたら ID を埋める。content script はこの ID のタブでだけ動く
    // タブは非アクティブで作る: アクティブで作るとフォーカスが移ってポップアップが閉じられ、
    // 後続の tabId の書き込みが走らないことがある。ID を保存し終えてからアクティブにする
    const skipBodyReview = skipReviewEl.checked;
    const insertToc = insertTocEl.checked;
    const embedUrls = embedUrlsEl.checked;
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
      Boolean(warning),
    );
  } catch (e) {
    setStatus((e as Error).message, true);
  } finally {
    submitEl.disabled = false;
  }
});
