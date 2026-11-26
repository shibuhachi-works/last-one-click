// note の編集画面の中で入れる工程: タイトル・目次・本文・埋め込み・本文の画像・本文を消す(書き換え)(content.ts から分けた。動きは変えていない)。
import { activeClock } from "../../../../shared/active-clock";
import { GIF_UPLOAD_WAIT_MS, IMAGE_UPLOAD_WAIT_MS, LATE_UPLOAD_WAIT_MS, gifUploadHint, hasGif } from "../../../../shared/upload-hint";
import { safeClick, safeKey } from "../safe-click";
import { htmlToText } from "../../../../shared/markdown-safe";
import { type ArticlePayload, type Selectors } from "../types";
import { placeCaret, visibleMatch, findTextRange, selectRange, caretToEnd, waitFor, waitUntil, waitWithStatus, pausedNote, formatWait, findByText, setNativeValue, base64ToFile, sleep } from "./dom";
import { StopError, bannerStatus } from "./banner";

/**
 * 書き換えで、今の本文を消す(#174)。本文の中を全部選んで消し、空になったかを確かめる。
 * 空にならなければ投げる(前の本文の上に貼って混ざらないように)
 */
export async function clearBody(S: Selectors) {
  // どんな失敗でも StopError にする(step は StopError のときだけ false を返し、本文の工程に進まない)
  try {
    return await clearBodyOnce(S);
  } catch (e) {
    throw e instanceof StopError ? e : new StopError(`今の本文を消せませんでした(${(e as Error).message})`);
  }
}

export async function clearBodyOnce(S: Selectors) {
  const el = await waitFor(S.body, 10_000);
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  await sleep(200);
  document.execCommand("delete", false);
  const empty = await waitUntil(() => ((el.innerText ?? "").trim() === "" && !el.querySelector("img, iframe, figure") ? true : null), 3_000);
  if (!empty) throw new StopError("今の本文を消せませんでした。本文は入れていません");
  return "消しました";
}

/** エディタのいちばん上(タイトル欄)まで画面を戻す。ページ全体と、エディタを包むスクロールする箱のどちらにも効くようにする */
export function scrollToTop(titleEl: HTMLElement) {
  titleEl.scrollIntoView({ block: "start", behavior: "auto" });
  window.scrollTo({ top: 0, behavior: "auto" });
}

// ---------------------------------------------------------------------------
// 各工程

export function fillTitle(el: HTMLElement, a: ArticlePayload) {
  el.focus();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    setNativeValue(el, a.title);
  } else {
    // contenteditable
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, a.title);
  }
}

/** 目次の工程で入った目次の要素(本文を、その次の行に貼るために使う) */
export type TocRef = { node: Element | null };

export const TOC_MANUAL = "本文の先頭で「+」→「目次」を押してください";

/**
 * 空の本文の 1 行目にカーソルを置き、「+」(メニューを開く)→「目次」を押す。
 * 目次はカーソルのある行の次の行に入る(2026-11-10 実機)。入ったかは、本文の子要素が増えたかで確かめる。
 * 失敗しても下書きづくりは止めない(step が ✗ を記録して先へ進む)
 */
export async function insertToc(S: Selectors, ref: TocRef) {
  const el = await waitFor(S.body, 10_000);
  el.focus();
  placeCaret(el, el.firstElementChild ?? el, "start");
  await sleep(200);
  const before = new Set(Array.from(el.children));

  const open = await waitUntil(() => visibleMatch(S.toc.openMenuButton), 3_000);
  if (!open) throw new Error(`「+」(メニューを開く)のボタンが見つかりません。${TOC_MANUAL}`);
  safeClick(open, "目次: メニューを開く");

  const item = await waitUntil(() => visibleMatch(S.toc.itemSelector) ?? findByText("button", S.toc.itemText), 3_000);
  if (!item) throw new Error(`メニューに「目次」が見つかりません。${TOC_MANUAL}`);
  safeClick(item, "目次: 目次を入れる");

  const added = await waitUntil(() => Array.from(el.children).find((c) => !before.has(c)) ?? null, 3_000);
  if (!added) throw new Error(`目次が入ったか確かめられませんでした。${TOC_MANUAL}`);
  ref.node = added;
  return "本文の先頭";
}

/** md→HTML を、クリップボードから貼り付けたのと同じ経路でエディタに渡す */
export async function pasteBody(S: Selectors, a: ArticlePayload, toc: TocRef = { node: null }) {
  const el = await waitFor(S.body, 10_000);
  el.focus();
  if (toc.node?.isConnected) {
    // 目次の下に貼る。目次の次の行があればその行頭、無ければ本文の最後にカーソルを置く
    const next = toc.node.nextElementSibling;
    if (next) placeCaret(el, next, "start");
    else placeCaret(el, el, "end");
    await sleep(200);
  }
  const dt = new DataTransfer();
  dt.setData("text/html", a.html);
  dt.setData("text/plain", htmlToText(a.html)); // innerHTML は使わない
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  await sleep(500);
  // 貼ったあとに目次が残っているかは確かめない。note のエディタは貼り付けで目次の要素を作り直し、作りも変わるので、
  // 要素や特徴で探すと、目次が残っていても「消えた」と誤って出た(2026-11-10 実機で 2 回)
}

/** URL だけの行(段落)の文字。前後の空白は無視する */
export const URL_LINE = /^https?:\/\/\S+$/;
/** 1 記事で埋め込みにする URL の行の上限(多すぎる記事で止まらないように) */
export const MAX_EMBEDS = 20;
export const EMBED_MANUAL = "URL の行の末尾で Enter を押すと埋め込みになります";

/** 本文の直下にある、URL だけが書かれた段落 */
export function urlLines(body: HTMLElement): HTMLElement[] {
  return Array.from(body.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && c.tagName === "P" && URL_LINE.test((c.textContent ?? "").trim()),
  );
}

/**
 * URL だけの行の末尾にカーソルを置いて Enter を送り、note の埋め込み(カード)に変える。
 * note は「URL の行の末尾で Enter」で埋め込みにする(2026-11-10 実機)。変わったかは、同じ URL の行が減ったかで確かめる
 * (エディタは画面の要素を作り直すので、要素そのものでは確かめない)。変わらなければ Enter で増えた空の行を消して残す。
 * キーは本文全体ではなく URL の行に送る(safeKey は送り先の文字を見るので、記事の中の言葉で止まらないように)
 */
export async function embedUrlLines(S: Selectors) {
  const body = await waitFor(S.body, 10_000);
  const all = urlLines(body).map((p) => (p.textContent ?? "").trim());
  if (all.length === 0) return "URL だけの行はなし";
  // 上限を超えた分は触らずに残し、最後にその件数を知らせる(黙って飛ばさない)
  const urls = all.slice(0, MAX_EMBEDS);
  const skipped = all.length - urls.length;
  const failed: string[] = [];
  for (const url of urls) {
    const count = () => urlLines(body).filter((p) => (p.textContent ?? "").trim() === url).length;
    const before = count();
    const line = urlLines(body).find((p) => (p.textContent ?? "").trim() === url);
    if (!line) continue;
    body.focus();
    caretToEnd(body, line);
    await sleep(200);
    safeKey(line, "埋め込み: URL の行で Enter", "Enter");
    const done = await waitUntil(() => (count() < before ? true : null), 5_000);
    if (!done) {
      failed.push(url);
      // Enter で増えた空の行を消す(カーソルは新しい空の行にある)
      const sel = window.getSelection();
      let n: Node | null = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
      while (n && n.parentNode !== body) n = n.parentNode;
      if (n instanceof HTMLElement && n.tagName === "P" && (n.textContent ?? "").trim() === "") safeKey(n, "埋め込み: 空の行を消す", "Backspace");
      await sleep(200);
    }
  }
  const problems: string[] = [];
  if (failed.length > 0) problems.push(`埋め込みにできなかった URL があります(${failed.join(", ")})`);
  if (skipped > 0) problems.push(`上限の ${MAX_EMBEDS} 件を超えた ${skipped} 件は埋め込みにしていません`);
  if (problems.length > 0) throw new Error(`${problems.join("。")}。${EMBED_MANUAL}`);
  return `${urls.length} 件`;
}

export const IMAGE_MANUAL = "本文の目印(［画像1・…］)の位置に、画像を入れてください";

/**
 * 本文の目印(［画像1・ab12: image1.png］。ab12 は変換のたびに変わる印)を 1 つずつ選び、その画像のファイルを貼り付ける(#51)。
 * 2026-11-10 の実機で、貼り付けのイベントに画像のファイルを載せると、note がアップロードして本文に入れることを確かめた。
 * 入ったかは、新しい <img> が増えて、その src がアップロード後の https の URL になったかで確かめる
 */
export async function insertBodyImages(S: Selectors, a: ArticlePayload) {
  const body = await waitFor(S.body, 10_000);
  const images = a.images ?? [];
  type Img = (typeof images)[number];
  const failed: string[] = [];
  /** note に送ったが入らなかった画像(gif のひとことを出すため) */
  const uploadFailed: Img[] = [];
  const captionFailed: string[] = [];
  /** 待ちきれなかった画像。最後にもう一度、遅れて入っていないかを確かめる */
  const pending: { img: Img; before: Set<HTMLImageElement>; own: Set<HTMLImageElement> }[] = [];
  /** すでにどれかの画像のものと分かった <img>(遅れて入った画像の取り違えを防ぐ) */
  const claimed = new Set<HTMLImageElement>();
  let ok = 0;

  /** 貼り付けたあとに増えた <img> のうち、アップロードが終わった(src が https の)もの。ほかの画像のものは除く */
  const uploaded = (before: Set<HTMLImageElement>) => {
    const added = Array.from(body.querySelectorAll("img")).filter((i) => !before.has(i) && !claimed.has(i));
    return added.length > 0 && added.every((i) => /^https?:/.test(i.src)) ? added[0] : null;
  };

  /** 入った画像の後始末: 残った目印を消し、キャプションを入れる */
  const finish = async (img: Img, done: HTMLImageElement) => {
    claimed.add(done);
    ok++;
    // 貼り付けで目印が置き換わらずに残ったときは、目印だけ消す
    const rest = findTextRange(body, img.marker);
    const holder = rest?.startContainer.parentElement;
    if (rest && holder) {
      selectRange(rest);
      await sleep(100);
      safeKey(holder, "本文の画像: 目印を消す", "Backspace");
      await sleep(200);
    }
    // md で ![説明](image1.png "キャプション") と書いたときは、画像のキャプションの欄に入れる
    if (img.caption && !(await setImageCaption(body, done, img.caption))) captionFailed.push(img.name);
  };

  /**
   * 遅れて入った画像が、この画像のものだと分かるときだけ返す(取り違えて、ほかの画像の目印を消したり、キャプションを入れたりしない)。
   * (1) この画像を貼ったときの仮の画像が、アップロードを終えた
   * (2) この画像の目印が残っていて、その後ろ、次の目印より前に、新しい画像が入った
   * (3) 待っているのがこの画像だけで、目印も仮の画像も無くなっていて、新しい画像が 1 枚だけ入った(仮の画像が作り直されたとき)
   */
  const lateUploaded = (p: (typeof pending)[number]): HTMLImageElement | null => {
    const https = (i: HTMLImageElement) => /^https?:/.test(i.src);
    const own = Array.from(p.own).find((i) => body.contains(i) && !claimed.has(i) && https(i));
    if (own) return own;
    const others = new Set(pending.flatMap((q) => (q === p ? [] : Array.from(q.own))));
    const fresh = Array.from(body.querySelectorAll("img")).filter((i) => !p.before.has(i) && !claimed.has(i) && !others.has(i) && https(i));
    const mark = findTextRange(body, p.img.marker);
    if (mark) {
      const after = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      const next = images
        .filter((o) => o !== p.img)
        .map((o) => findTextRange(body, o.marker)?.startContainer)
        .filter((n): n is Node => !!n && after(mark.startContainer, n));
      return fresh.find((i) => after(mark.startContainer, i) && next.every((n) => after(i, n))) ?? null;
    }
    const ownLeft = Array.from(p.own).some((i) => body.contains(i));
    return pending.length === 1 && !ownLeft && fresh.length === 1 ? fresh[0] : null;
  };

  for (const [i, img] of images.entries()) {
    const range = findTextRange(body, img.marker);
    if (!range) {
      failed.push(img.name);
      continue;
    }
    body.focus();
    selectRange(range);
    await sleep(200);
    const before = new Set(Array.from(body.querySelectorAll("img")));
    const dt = new DataTransfer();
    dt.items.add(base64ToFile(img));
    body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    // gif は note の側の処理に時間がかかり、30 秒を過ぎてから入ることがある(2026-11-13 実機)ので長めに待つ
    const limit = hasGif([img]) ? GIF_UPLOAD_WAIT_MS : IMAGE_UPLOAD_WAIT_MS;
    const done = await waitWithStatus(
      () => uploaded(before),
      limit,
      (sec, paused) =>
        `本文の画像を入れています(${i + 1}/${images.length} 枚目)… ${sec} 秒${pausedNote(paused)}`,
    );
    if (!done) {
      // 貼り付けで入った仮の画像(まだ blob: のもの)を覚えておく。遅れて入ったかは、まずこれで確かめる
      const own = new Set(Array.from(body.querySelectorAll("img")).filter((i) => !before.has(i) && !claimed.has(i) && !pending.some((q) => q.own.has(i))));
      pending.push({ img, before, own });
      continue;
    }
    await finish(img, done);
  }

  // 待ちきれなかった画像が、そのあと遅れて入っていないかを確かめる(入っていれば、目印を消してキャプションを入れる)
  if (pending.length) {
    // ダイアログなどでページが止まっていた時間は数えない(shared/active-clock.ts)
    const clock = activeClock();
    for (;;) {
      bannerStatus(
        `画像が入るのを待っています(${pending.length} 枚)… ${Math.floor(clock.elapsed() / 1000)} 秒${pausedNote(clock.paused())}`,
      );
      for (const p of [...pending]) {
        const done = lateUploaded(p);
        if (!done) continue;
        pending.splice(pending.indexOf(p), 1);
        await finish(p.img, done);
      }
      if (!pending.length || clock.elapsed() >= LATE_UPLOAD_WAIT_MS) break;
      await sleep(500);
    }
    for (const p of pending) {
      failed.push(p.img.name);
      uploadFailed.push(p.img);
    }
  }

  const problems = [...(a.imageNotes ?? [])];
  if (captionFailed.length) problems.unshift(`キャプションを入れられなかった画像があります(${captionFailed.join(", ")})`);
  const gifHint = gifUploadHint(uploadFailed);
  if (failed.length) problems.unshift(`入れられなかった画像があります(${failed.join(", ")})${gifHint ? `。${gifHint}` : ""}`);
  // 1 枚も入らなかったときは「0 枚は入れました」と出さない
  if (problems.length) throw new Error(`${ok ? `${ok} 枚は入れました。` : ""}${problems.join("。")}。${IMAGE_MANUAL}`);
  return `${ok} 枚`;
}

/**
 * 入れた画像の下のキャプションの欄(figcaption)にカーソルを置き、文字を入れる。
 * 入ったかどうかは、欄の文字で確かめる(入らなければ false)
 */
export async function setImageCaption(body: HTMLElement, img: HTMLImageElement, caption: string): Promise<boolean> {
  // 入れた画像の要素がまだ本文にあれば、それを使う。作り直されていたときだけ、同じ src の画像のうち
  // キャプションが空のもの(最後のもの)を探す(同じ画像を 2 回使っても、前の画像のキャプションに入れない)
  const current = body.contains(img)
    ? img
    : Array.from(body.querySelectorAll("img"))
        .filter((i) => i.src === img.src && !i.closest("figure")?.querySelector("figcaption")?.textContent?.trim())
        .pop();
  if (!current) return false;
  const cap = current.closest("figure")?.querySelector<HTMLElement>("figcaption");
  if (!cap) return false;
  body.focus();
  // 空の欄(ProseMirror では <br> だけが入っている)の先頭にカーソルを置く
  const sel = window.getSelection();
  if (!sel) return false;
  const range = document.createRange();
  range.setStart(cap, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  await sleep(100);
  document.execCommand("insertText", false, caption);
  return Boolean(await waitUntil(() => (cap.isConnected ? cap : current.closest("figure")?.querySelector("figcaption"))?.textContent?.includes(caption) || null, 3_000));
}
