// 入れる先(note の新しいタブ・開いている note の記事の書き換え・追加の対応先)を決め、ボタンの文字と押せる設定を合わせる(popup.ts から分けた。動きは変えていない)。
import { parse as parseYaml } from "yaml";
import { parseFrontMatter, targetProblem, type Destination } from "../../../../shared/article";
import { checkNoteUrl, noteEditKey, noteUrlProblem } from "../../../../shared/note-rewrite";
import { EXTRA_SITE_ENABLED, EXTRA_SITE_SUBMIT_LABEL, EXTRA_SITE_NEW_SUBMIT_LABEL, shouldFillExtraSite } from "../../../../shared/extra-site";
import { chromeExtraSiteApi } from "../extra-site";
import { type Message, type NoteArticleResponse } from "../types";
import { $, STATUS_IDS, setStatus } from "./dom";
import { state } from "./state";
import { isWindow, markdownEl, submitEl, skipReviewEl, noteSubmitText, REWRITE_SUBMIT_LABEL, submitNewEl, submitHintEl, noteSubmitHint, NOTE_ONLY_CONTROLS, UNAVAILABLE_NOTE } from "./elements";
import { renderAccountTarget } from "./account";
import { renderFieldsSummary } from "./fields";

/**
 * 入れる先(このタブか、新しい note のタブか)とボタンの文字を決め直す。開いたときと、許可が変わったとき(#120)。
 * 許可があり、今のタブがその編集画面なら、新しいタブを開かずにこのタブに入れる
 */
export function refreshExtraSiteFillTarget() {
  if (!EXTRA_SITE_ENABLED || isWindow) return;
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(async ([tab]) => ((await shouldFillExtraSite(chromeExtraSiteApi, tab)) ? tab?.id : undefined))
    .catch(() => undefined)
    .then((id) => {
      state.extraSiteFillTabId = id;
      applyDestination();
    });
}

/**
 * 書き換える記事を決め直す。ツールバーのポップアップは今のタブ、ウィンドウで開いたときは引き継いだタブ。
 * タイトルは、そのタブの content script に聞く(読めなければ「(タイトルなし)」)
 */
export async function refreshRewriteTarget(tabId?: number) {
  const tab =
    tabId !== undefined
      ? await chrome.tabs.get(tabId).catch(() => undefined)
      : isWindow
        ? undefined
        : (await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []))[0];
  const key = noteEditKey(tab?.url);
  if (!tab?.id || !key) {
    state.rewriteTarget = undefined;
  } else {
    const res = (await chrome.tabs.sendMessage(tab.id, { type: "noteArticle" } satisfies Message).catch(() => null)) as NoteArticleResponse | null;
    state.rewriteTarget = { tabId: tab.id, key, title: res?.title ?? "" };
  }
  checkTargetNow();
}

/** 書き換えになるか(書き換える記事があり、入れる先が note のとき) */
export function rewriteMode(): boolean {
  return state.rewriteTarget !== undefined && destination() === "note";
}

/** md の note_url と、開いている記事が合わないときの知らせ。合えば(または書いていなければ)null */
export function noteUrlMismatch(): string | null {
  if (!rewriteMode() || !markdownEl.value.trim()) return null;
  try {
    return noteUrlProblem(checkNoteUrl(parseFrontMatter(markdownEl.value, parseYaml).data.noteUrl, state.rewriteTarget!.key));
  } catch {
    return null;
  }
}

/** 書き換えの表示(開いている記事の名前・新しい下書きのボタン・ボタンの下の説明)を、今の状態に合わせる */
export function renderRewrite() {
  const on = rewriteMode();
  $("rewrite-box").hidden = !on;
  submitNewEl.hidden = !on;
  if (on) {
    $("rewrite-target").textContent = `今開いている記事:『${state.rewriteTarget!.title || "(タイトルなし)"}』`;
    submitHintEl.textContent = "今開いているタブに入れます。";
  } else {
    submitHintEl.innerHTML = noteSubmitHint;
  }
}

/**
 * 新しいタブで追加の対応先の新規記事を開いて入れるか。今のタブが編集画面でなく、許可があり、
 * 記事の target が note 以外のとき(note と同じく、別のページからも作れるように)
 */
export function extraSiteNewMode(): boolean {
  if (!EXTRA_SITE_ENABLED || !state.extraSiteGranted || state.extraSiteFillTabId !== undefined || !markdownEl.value.trim()) return false;
  try {
    const t = parseFrontMatter(markdownEl.value, parseYaml).data.target?.trim();
    return !!t && t.toLowerCase() !== "note";
  } catch {
    return false;
  }
}

/** 入れる先。今のタブが追加の対応先の編集画面か、記事の target が note 以外で許可があれば extra-site */
export function destination(): Destination {
  return state.extraSiteFillTabId !== undefined || extraSiteNewMode() ? "extra-site" : "note";
}

/** ボタンの文字を、入れる先に合わせる */
export function submitTextFor(): string {
  if (state.extraSiteFillTabId !== undefined) return EXTRA_SITE_SUBMIT_LABEL;
  if (rewriteMode()) return REWRITE_SUBMIT_LABEL;
  return extraSiteNewMode() ? EXTRA_SITE_NEW_SUBMIT_LABEL : noteSubmitText;
}

/** 入れる先に合わせて、note にだけある設定の押せる・押せないと、target の確かめを今の状態にする */
export function applyDestination() {
  checkTargetNow();
}

/**
 * 入れる先に合わせて、ボタンの文字・note にだけある設定の押せる・押せない・note のアカウントの表示を合わせる。
 * 入れる先は記事の target でも変わる(新しいタブで追加の対応先を開くとき)ので、記事を読むたびに checkTargetNow から呼ぶ
 */
export function applyDestinationControls() {
  submitEl.textContent = submitTextFor();
  const toExtraSite = destination() === "extra-site";
  for (const el of NOTE_ONLY_CONTROLS) {
    el.disabled = toExtraSite;
    const label = el.closest("label");
    if (!label) continue;
    // 「直す」の中の欄(マガジン・価格)は、使えないときは出さない(一覧の行も出さない。#191)
    if (label.closest("#fields-edit")) {
      label.hidden = toExtraSite;
      continue;
    }
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
  $("account").hidden = !state.loggedInAccount;
  $("extra-site-account").hidden = !state.extraSiteAccountShown;
  renderAccountTarget();
}

/**
 * 記事の target が入れる先と合わなければ、読み込んだ時点で知らせてボタンを止める(押してから止めるより先に分かる)。
 * 知らせは、押せなくした「note の下書きを作成」のすぐ下(#status)に出す。押せない理由がボタンのそばで分かるように
 */
export function checkTargetNow() {
  if (state.submitting) return;
  applyDestinationControls();
  const problem = markdownEl.value.trim() ? (targetProblem(markdownEl.value, destination(), parseYaml) ?? noteUrlMismatch()) : null;
  submitEl.disabled = problem !== null;
  const submitStatusEl = document.getElementById(STATUS_IDS.submit);
  if (problem) {
    setStatus(problem, { error: true, near: "submit" });
    state.targetProblemShown = problem;
  } else if (submitStatusEl && state.targetProblemShown !== null && submitStatusEl.textContent === state.targetProblemShown.replace(/。(?=.)/g, "。\n")) {
    submitStatusEl.hidden = true;
    submitStatusEl.textContent = "";
    submitStatusEl.removeAttribute("role");
    state.targetProblemShown = null;
  }
}
