// ポップアップ。入力を ArticlePayload に組み立てて chrome.storage に置き、
// note のエディタを新しいタブで開く。実際の入力は content.ts が行う。
// このファイルには、ボタンなどへの登録と、開いたときに 1 回だけ行うことを、動く順番のまま置く。
// 中身の関数は lib/popup/ にある(状態は lib/popup/state.ts、画面の要素は lib/popup/elements.ts)。
import { checkSelectorsUrl } from "../../shared/selectors-url";
import { parsePullUrl } from "../../shared/github-pr";
import { collectFolderFiles, type FsDirEntry, type FsFileEntry } from "../../shared/bundle";
import { MAX_ZIP_ENTRIES, isBundleFile } from "../../shared/zip";
import { findPullArticlesOnGitHub, fileToPayload, payloadToFile } from "./lib/article";
import { EXTRA_SITE_ENABLED, disableExtraSite, enableExtraSite, shouldOfferExtraSite, syncExtraSite } from "../../shared/extra-site";
import { chromeExtraSiteApi } from "./lib/extra-site";
import { safeClick } from "./lib/safe-click";
import { STORAGE, type DiagnoseResponse, type Message, type WindowHandoff } from "./lib/types";
import { $, setStatus } from "./lib/popup/dom";
import { state } from "./lib/popup/state";
import { isZip, zipItems } from "./lib/popup/zip";
import { isWindow, HANDOFF_IMAGE_MAX_BYTES, markdownEl, titleEl, hashtagsEl, magazineEl, priceEl, thumbnailEl, githubUrlEl, markdownFileEl, markdownBoxEl, submitEl, skipReviewEl, insertTocEl, creditLinkEl, extraSiteOfferEl, extraSiteToggleEl, submitNewEl, advancedToggle, githubPickEl, githubArticleEl, fieldsEl } from "./lib/popup/elements";
import { showArticleOptions, applyAdvanced, showCopied } from "./lib/popup/settings";
import { refreshExtraSiteFillTarget, refreshRewriteTarget, checkTargetNow } from "./lib/popup/destination";
import { showExtraSiteSetting, findExtraSiteTab, findNoteTab, showAccount, readNoteAccount, renderAccountTarget } from "./lib/popup/account";
import { loadGitHubArticle, loadMarkdownFile, loadLooseFiles, loadBundle } from "./lib/popup/sources";
import { forgetSource, renderFieldsSummary, fieldsEdited, fillFieldsFromMarkdown, setThumbnailFile, renderPicked } from "./lib/popup/fields";
import { submitArticle } from "./lib/popup/submit";

// 別ウィンドウ表示(isWindow の説明は lib/popup/elements.ts)。入力途中の状態は chrome.storage.session で新しいウィンドウに引き継ぐ
if (isWindow) document.body.classList.add("window");
$("open-window").addEventListener("click", async () => {
  try {
    const handoff: WindowHandoff = {
      markdown: markdownEl.value,
      title: titleEl.value,
      hashtags: hashtagsEl.value,
      magazine: magazineEl.value,
      price: priceEl.value,
      baseUrl: state.baseUrl,
      mdName: state.pickedMdName,
      fieldsEdited: { ...fieldsEdited },
      ...(state.rewriteTarget ? { rewriteTabId: state.rewriteTarget.tabId } : {}),
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
    state.baseUrl = h.baseUrl;
    state.pickedMdName = h.mdName ?? "";
    if (h.fieldsEdited) Object.assign(fieldsEdited, { price: false, ...h.fieldsEdited });
    if (h.thumbnail) setThumbnailFile(payloadToFile(h.thumbnail));
    renderPicked();
    // 引き継いだ md の note_account も読み直す(fillFieldsFromMarkdown は呼ばない。直した欄を上書きしないため)
    state.articleNoteAccount = readNoteAccount(h.markdown);
    renderAccountTarget();
    if (h.rewriteTabId !== undefined) void refreshRewriteTarget(h.rewriteTabId);
    if (h.skippedImageName) {
      setStatus(`見出し画像「${h.skippedImageName}」は大きいので引き継げませんでした。もう一度選んでください。`, { error: true, near: "drop" });
    } else if (h.markdown || h.thumbnail) {
      setStatus("入力途中の内容を引き継ぎました。", { near: "drop" });
    }
  });
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
for (const el of [insertTocEl, skipReviewEl]) el.addEventListener("change", showArticleOptions);
// 「本文の確認を飛ばして、公開設定まで進む」は次回も同じにする
skipReviewEl.addEventListener("change", () => chrome.storage.local.set({ [STORAGE.skipBodyReview]: skipReviewEl.checked }));
// 「記事の先頭に目次を入れる」も次回も同じにする
insertTocEl.addEventListener("change", () => chrome.storage.local.set({ [STORAGE.insertToc]: insertTocEl.checked }));
// 「記事の最後に『Last One Click で下書きしました』のリンクを入れる」も次回も同じにする
creditLinkEl.addEventListener("change", () => chrome.storage.local.set({ [STORAGE.creditLink]: creditLinkEl.checked }));

void refreshRewriteTarget();

// 実機で下書きの入力を確かめるまでは、ふつうのビルドでは入口を出さない(EXTRA_SITE_ENABLED。shared/extra-site.ts)
if (EXTRA_SITE_ENABLED) {
  chromeExtraSiteApi.hasPermission().then(showExtraSiteSetting, () => showExtraSiteSetting(false));
  // 別ウィンドウで開いたときは、今のウィンドウ = この画面なので、ページは見ない
  if (!isWindow) {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(async ([tab]) => {
        state.extraSiteOffer = await shouldOfferExtraSite(chromeExtraSiteApi, tab);
        $("extra-site-offer-editor").hidden = state.extraSiteOffer !== "editor";
        $("extra-site-offer-site").hidden = state.extraSiteOffer !== "site";
        extraSiteOfferEl.hidden = state.extraSiteOffer === null;
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
          state.extraSiteOffer === "editor"
            ? "使えるようにしました。ページを再読み込みしてください。"
            : "使えるようにしました。新規記事のエディタを開いて、もう一度アイコンを押してください。",
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
        if (!granted) setStatus("許可を外しました。", { near: "extraSiteToggle" });
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
advancedToggle.addEventListener("change", async () => {
  const next = advancedToggle.checked;
  await chrome.storage.local.set({ [STORAGE.advancedMode]: next });
  applyAdvanced(next);
  setStatus(next ? "表示しました。" : "隠しました。", { near: "advanced" });
});
$("save-settings").addEventListener("click", async () => {
  await chrome.storage.local.set({ [STORAGE.githubToken]: $<HTMLInputElement>("github-token").value.trim() });
  setStatus("保存しました。", { near: "settings" });
});
$("save-selectors").addEventListener("click", async () => {
  // 記事の URL をこの欄に入れる間違いがあったので、保存する前に確かめる(保存はしない)
  const selectorsUrlProblem = checkSelectorsUrl($<HTMLInputElement>("selectors-url").value);
  if (selectorsUrlProblem) {
    setStatus(selectorsUrlProblem, { error: true, near: "selectors" });
    return;
  }
  await chrome.storage.local.set({ [STORAGE.selectorsUrl]: $<HTMLInputElement>("selectors-url").value.trim() });
  await chrome.storage.local.remove(STORAGE.selectorsCache);
  setStatus("保存しました。", { near: "selectors" });
});

// 診断:アクティブなタブ(note)の content script にレポートを作らせてコピーする。
// 開発用のビルドでは、今のタブが追加の対応先のページなら、そちらの content script にレポートを作らせる(#118)
$("diagnose").addEventListener("click", async () => {
  const out = $<HTMLTextAreaElement>("diagnose-out");
  try {
    const extraTab = await findExtraSiteTab();
    if (extraTab && !(await chromeExtraSiteApi.hasPermission())) {
      throw new Error("このサイトは、まだ使えるようにしていません。案内の「使えるようにする」を押してください。");
    }
    const tab = extraTab ?? (await findNoteTab());
    if (!tab?.id) throw new Error("note のエディタを開いてから押してください。");
    const res = (await chrome.tabs.sendMessage(tab.id, { type: "diagnose" } satisfies Message).catch(() => null)) as
      | DiagnoseResponse
      | null;
    if (!res) {
      throw new Error(extraTab ? "今開いているページを再読み込みしてから、もう一度押してください。" : "note のタブを再読み込みしてから、もう一度押してください。");
    }
    if (!res.ok) throw new Error(res.error);
    out.value = res.report;
    $<HTMLButtonElement>("diagnose-copy").disabled = false;
    // 取得と同時にコピーも試す(別ウィンドウ等でクリップボードが使えないことがあるので、失敗しても結果は欄に残す)
    const copied = await navigator.clipboard.writeText(res.report).then(() => true, () => false);
    if (copied) showCopied();
    setStatus(copied ? "コピーしました。" : "取得しました。「コピー」を押してください。", { near: "diagnose" });
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
  setStatus(copied ? "コピーしました。" : "コピーできませんでした。選んだ所を Cmd+C でコピーしてください。", { error: !copied, near: "diagnose" });
});

void showAccount();

$("github-load").addEventListener("click", async () => {
  githubPickEl.hidden = true;
  githubArticleEl.replaceChildren();
  try {
    const input = githubUrlEl.value.trim();
    const pull = parsePullUrl(input);
    if (!pull) {
      setStatus("GitHub から取得中...", { near: "github" });
      await loadGitHubArticle(input);
      return;
    }
    setStatus("PR の記事を探しています...", { near: "github" });
    const { articles } = await findPullArticlesOnGitHub(pull);
    if (articles.length === 1) {
      setStatus("GitHub から取得中...", { near: "github" });
      await loadGitHubArticle(articles[0].url, articles[0].label);
      return;
    }
    for (const a of articles) githubArticleEl.append(new Option(a.label, a.url));
    setStatus(`記事が ${articles.length} 本あります。読み込む記事を選んでください。`, { near: "github" });
    githubPickEl.hidden = false;
  } catch (e) {
    setStatus((e as Error).message, { error: true, near: "github" });
  }
});

$("github-pick-load").addEventListener("click", async () => {
  const opt = githubArticleEl.selectedOptions[0];
  if (!opt) return;
  try {
    setStatus("GitHub から取得中...", { near: "github" });
    await loadGitHubArticle(opt.value, opt.text);
  } catch (e) {
    setStatus((e as Error).message, { error: true, near: "github" });
  }
});
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

// 「md ファイルを選ぶ」「画像を選ぶ」は本物の button(キーボードでも押せる)。隠した file input を開く。
// 拡張内の file input でも、クリックは必ず safeClick() を通す(AGENTS.md)
$("pick-md").addEventListener("click", () => safeClick(markdownFileEl, "popup.pickMarkdown"));
$("pick-image").addEventListener("click", () => safeClick(thumbnailEl, "popup.pickImage"));

for (const el of [titleEl, hashtagsEl, magazineEl, priceEl]) el.addEventListener("input", renderFieldsSummary);
titleEl.addEventListener("input", () => {
  fieldsEdited.title = true;
  titleEl.classList.toggle("missing", !titleEl.value.trim());
});
hashtagsEl.addEventListener("input", () => (fieldsEdited.hashtags = true));
magazineEl.addEventListener("input", () => (fieldsEdited.magazine = true));
priceEl.addEventListener("input", () => (fieldsEdited.price = true));

thumbnailEl.addEventListener("change", renderPicked);

// 本体
submitEl.addEventListener("click", () => void submitArticle(false));
// 書き換えられる記事を開いていても、新しい下書きとして作れるように(#174)
submitNewEl.addEventListener("click", () => void submitArticle(true));
