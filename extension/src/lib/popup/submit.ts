// 下書きを作るボタン(#submit)と「新しい下書きとして作る」の中身: 記事を組み立てて、新しいタブ・開いている記事・追加の対応先に送る(popup.ts から分けた。動きは変えていない)。
import { REWRITE_UNDO_NOTE, checkNoteUrl, noteEditKey, noteUrlProblem } from "../../../../shared/note-rewrite";
import { buildArticle } from "../article";
import { EXTRA_SITE_HOST } from "../../../../shared/extra-site";
import { loadSelectors } from "../selectors";
import { STORAGE, type ExtraSiteFillResponse, type Message, type NoteRewriteResponse } from "../types";
import { setStatus } from "./dom";
import { state } from "./state";
import { notesText, extraSiteMessage } from "./extra-site-message";
import { isWindow, markdownEl, titleEl, hashtagsEl, magazineEl, priceEl, thumbnailEl, submitEl, skipReviewEl, insertTocEl, creditLinkEl, submitNewEl } from "./elements";
import { rewriteMode, extraSiteNewMode, destination, checkTargetNow } from "./destination";

/** 「note の下書きを作成」(書き換えのときは「この記事を書き換える」)。forceNew なら、書き換えずに新しい下書きを作る */
export async function submitArticle(forceNew: boolean) {
  if (state.submitting) return;
  submitEl.disabled = true;
  submitNewEl.disabled = true;
  state.submitting = true;
  try {
    if (!markdownEl.value.trim()) throw new Error("記事の md ファイルをドロップするか、「md ファイルを選ぶ」で選んでください。");

    setStatus("記事を組み立て中...", { near: "submit" });
    const article = await buildArticle({
      markdown: markdownEl.value,
      thumbnailFile: thumbnailEl.files?.[0] ?? null,
      baseUrl: state.baseUrl,
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
      bodyImageFiles: state.bodyImageFiles,
      bodyImagesBySrc: state.bodyImagesBySrc,
      // front matter の target と入れる先が合わなければ、ここで止まる(タブを開く前)
      destination: destination(),
    });

    if (state.extraSiteFillTabId !== undefined) {
      await fillExtraSiteTab(state.extraSiteFillTabId, article);
      return;
    }
    if (extraSiteNewMode()) {
      await openExtraSiteAndFill(article);
      return;
    }

    if (!forceNew && rewriteMode()) {
      await rewriteNoteTab(state.rewriteTarget!, article);
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
    state.submitting = false;
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
export async function rewriteNoteTab(target: { tabId: number; key: string }, article: Awaited<ReturnType<typeof buildArticle>>) {
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
export async function fillExtraSiteTab(tabId: number, article: Awaited<ReturnType<typeof buildArticle>>) {
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
export async function openExtraSiteAndFill(article: Awaited<ReturnType<typeof buildArticle>>) {
  const { notes, extraArticle } = extraSiteMessage(article);
  // 閉じる前に読めるよう、知らせを先に出しておく
  setStatus(`${EXTRA_SITE_HOST} の新規記事を新しいタブで開いています。続きはそのページの右下に出ます。` + notesText(notes), { error: notes.length > 0, near: "submit" });
  const res = (await chrome.runtime.sendMessage({ type: "extraSiteOpenAndFill", article: extraArticle, notes } satisfies Message).catch(() => null)) as ExtraSiteFillResponse | null;
  if (!res) throw new Error("新しいタブを開けませんでした。もう一度押してください。");
  if (!res.ok) throw new Error(res.error);
}
