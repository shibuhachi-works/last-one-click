// ポップアップ。入力を ArticlePayload に組み立てて chrome.storage に置き、
// note のエディタを新しいタブで開く。実際の入力は content.ts が行う。
import { parse as parseYaml } from "yaml";
import { parseFrontMatter } from "../../shared/article";
import { buildArticle, fetchMarkdownFromGitHub, fileToPayload, payloadToFile } from "./lib/article";
import { safeClick } from "./lib/safe-click";
import { loadSelectors } from "./lib/selectors";
import { STORAGE, type DiagnoseResponse, type Message, type WindowHandoff } from "./lib/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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
const thumbnailEl = $<HTMLInputElement>("thumbnail");
const githubUrlEl = $<HTMLInputElement>("github-url");
const markdownFileEl = $<HTMLInputElement>("markdown-file");
const markdownBoxEl = $<HTMLDivElement>("markdown-box");
const statusEl = $<HTMLParagraphElement>("status");
const submitEl = $<HTMLButtonElement>("submit");
const skipReviewEl = $<HTMLInputElement>("skip-review");

let baseUrl: string | undefined; // GitHub から読んだ場合の、相対 thumbnail の基準

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
    baseUrl = h.baseUrl;
    pickedMdName = h.mdName ?? "";
    if (h.fieldsEdited) Object.assign(fieldsEdited, h.fieldsEdited);
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
chrome.storage.local.get([STORAGE.selectorsUrl, STORAGE.githubToken, STORAGE.advancedMode, STORAGE.skipBodyReview]).then((s) => {
  $<HTMLInputElement>("selectors-url").value = (s[STORAGE.selectorsUrl] as string | undefined) ?? "";
  $<HTMLInputElement>("github-token").value = (s[STORAGE.githubToken] as string | undefined) ?? "";
  applyAdvanced(Boolean(s[STORAGE.advancedMode]));
  skipReviewEl.checked = Boolean(s[STORAGE.skipBodyReview]);
});
// 「本文の確認を飛ばして、公開設定まで進む」は次回も同じにする
skipReviewEl.addEventListener("change", () => chrome.storage.local.set({ [STORAGE.skipBodyReview]: skipReviewEl.checked }));

// 上級者向け(GitHub から読み込む・貼り付け・selectors の URL・GitHub トークン)は普段は隠す。
// 「設定」のチェックで表示/非表示を切り替え、chrome.storage に覚える
$<HTMLParagraphElement>("version").textContent = `Last One Click v${chrome.runtime.getManifest().version}`;
const advancedToggle = $<HTMLInputElement>("advanced-toggle");
function applyAdvanced(on: boolean) {
  advancedToggle.checked = on;
  $("advanced-github").hidden = !on;
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
    setStatus(copied ? "診断結果を取得してコピーしました。そのまま貼り付けて共有してください。" : "診断結果を取得しました。「コピー」を押すか、欄の中を選んでコピーしてください。");
  } catch (e) {
    setStatus((e as Error).message, true);
  }
});
$("diagnose-copy").addEventListener("click", async () => {
  const out = $<HTMLTextAreaElement>("diagnose-out");
  if (!out.value) return;
  const copied = await navigator.clipboard.writeText(out.value).then(() => true, () => false);
  if (!copied) {
    out.focus();
    out.select();
  }
  setStatus(copied ? "診断結果をコピーしました。" : "クリップボードに書けなかったので、欄の中を選択しました。Cmd+C でコピーしてください。", !copied);
});

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

// GitHub から md を読み込んで textarea に入れる
$("github-load").addEventListener("click", async () => {
  try {
    setStatus("GitHub から取得中...");
    const r = await fetchMarkdownFromGitHub(githubUrlEl.value.trim());
    markdownEl.value = r.markdown;
    baseUrl = r.baseUrl;
    fillFieldsFromMarkdown(r.markdown, { newSource: true });
    setStatus("読み込みました。内容を確認して「組み立てる」を押してください。");
  } catch (e) {
    setStatus((e as Error).message, true);
  }
});
markdownEl.addEventListener("input", () => (baseUrl = undefined));
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
  pickedMdName = file.name;
  renderPicked();
  markdownFileEl.value = ""; // 同じファイルをもう一度選んでも change が出るように
  const fm = text.split(/^---\s*$/m)[1] ?? "";
  const hasThumbnail = /^thumbnail:/m.test(fm);
  const { titleMissing } = fillFieldsFromMarkdown(text, { newSource: true });
  setStatus(
    `${file.name} を読み込みました。` +
      (titleMissing ? "md ファイルにタイトルが無いので「タイトル」に入力してください。" : "内容を確認して「note の下書きを作成」を押してください。") +
      (hasThumbnail ? "\n見出し画像はファイルからは辿れないので、ドロップするか「画像を選ぶ」で画像を選んでください。" : ""),
    titleMissing,
  );
  if (titleMissing) titleEl.focus();
}
markdownFileEl.addEventListener("change", async () => {
  const file = markdownFileEl.files?.[0];
  if (!file) return;
  try {
    await loadMarkdownFile(file);
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
  const image = files.find((f) => f.type.startsWith("image/"));
  const md = files.find((f) => !f.type.startsWith("image/"));
  const got: string[] = [];
  try {
    if (image) {
      setThumbnailFile(image);
      got.push(`見出し画像: ${image.name}`);
    }
    if (md) {
      await loadMarkdownFile(md);
      got.push(`md ファイル: ${md.name}`);
    }
    if (files.length > 2 || (!image && files.length > 1)) got.push("(3 つ目以降は無視)");
    setStatus(`${got.join(" / ")} を受け取りました。「note の下書きを作成」を押してください。`);
  } catch (err) {
    setStatus((err as Error).message, true);
  }
});

// 「md を選ぶ」「画像を選ぶ」は本物の button(キーボードでも押せる)。隠した file input を開く。
// 拡張内の file input でも、クリックは必ず safeClick() を通す(AGENTS.md)
$("pick-md").addEventListener("click", () => safeClick(markdownFileEl, "popup.pickMarkdown"));
$("pick-image").addEventListener("click", () => safeClick(thumbnailEl, "popup.pickImage"));

/**
 * md の front matter(と先頭の # 見出し)から、note に入れるタイトル・ハッシュタグ・マガジンを欄に出す。
 * 欄は普段は隠していて、md を読み込んだときだけ出す。送るのは欄の値(ここで直せる)
 */
const fieldsEl = $<HTMLDivElement>("fields");
/** ユーザーが欄を直したか。直した欄は、本文の再読み取りで上書きしない(新しい md を読み込んだときはリセット) */
const fieldsEdited = { title: false, hashtags: false, magazine: false };
function fillFieldsFromMarkdown(md: string, opts: { newSource: boolean }): { titleMissing: boolean } {
  let title = "";
  let hashtags: string[] = [];
  let magazine = "";
  try {
    const { data, content } = parseFrontMatter(md, parseYaml);
    title = data.title ?? content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
    hashtags = data.hashtags ?? [];
    magazine = data.magazine ?? "";
  } catch {
    // front matter が読めないときは空のまま出す(組み立て時に同じエラーを案内する)
  }
  if (opts.newSource) fieldsEdited.title = fieldsEdited.hashtags = fieldsEdited.magazine = false;
  if (!fieldsEdited.title) titleEl.value = title;
  if (!fieldsEdited.hashtags) hashtagsEl.value = hashtags.join(", ");
  if (!fieldsEdited.magazine) magazineEl.value = magazine;
  fieldsEl.hidden = false;
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
  el.hidden = parts.length === 0;
  el.textContent = parts.length ? `受け取り済み: ${parts.join(" / ")}` : "";
}

// 本体
submitEl.addEventListener("click", async () => {
  submitEl.disabled = true;
  try {
    if (!markdownEl.value.trim()) throw new Error("記事の md ファイルをドロップするか、「md を選ぶ」で選んでください。");

    setStatus("記事を組み立て中...");
    const article = await buildArticle({
      markdown: markdownEl.value,
      thumbnailFile: thumbnailEl.files?.[0] ?? null,
      baseUrl,
      // 欄の値が「送る内容」。空にしたら front matter に戻らず「なし」(final)
      override: { title: titleEl.value, hashtags: hashtagsEl.value, magazine: magazineEl.value, final: true },
    });

    const { selectors, source, warning } = await loadSelectors();
    // newNoteUrl は loadSelectors の中で note の origin であることを検査済み
    // 先に pending を置き(tabId: null)、タブを開いたら ID を埋める。content script はこの ID のタブでだけ動く
    // タブは非アクティブで作る: アクティブで作るとフォーカスが移ってポップアップが閉じられ、
    // 後続の tabId の書き込みが走らないことがある。ID を保存し終えてからアクティブにする
    const skipBodyReview = skipReviewEl.checked;
    await chrome.storage.local.set({ [STORAGE.pendingArticle]: { ...article, tabId: null, skipBodyReview } });
    const tab = await chrome.tabs.create({ url: selectors.newNoteUrl, active: false });
    if (tab.id === undefined) {
      await chrome.storage.local.remove(STORAGE.pendingArticle);
      throw new Error("タブを開けませんでした。");
    }
    await chrome.storage.local.set({ [STORAGE.pendingArticle]: { ...article, tabId: tab.id, skipBodyReview } });
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
