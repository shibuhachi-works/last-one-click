// note.com のタブで動く content script。
// chrome.storage に pending の記事があれば、エディタに入力して公開ボタンの手前で止まる。
// ログイン状態はこのタブのものをそのまま使う(拡張は Cookie に触らない)。
import { normalizeLabel } from "../../shared/forbidden-click";
import { matchesAnyText } from "../../shared/text-match";
import { buildDiagnosticReport, describe, rect } from "./lib/diagnose";
import { findEyecatchButton } from "../../shared/eyecatch-button";
import { activeClock, type ActiveClock } from "../../shared/active-clock";
import { GIF_UPLOAD_WAIT_MS, IMAGE_UPLOAD_WAIT_MS, LATE_UPLOAD_WAIT_MS, gifUploadHint, hasGif } from "../../shared/upload-hint";
import { findMagazineRowButton } from "../../shared/magazine-row";
import { articleKey, isSameArticle, lockArticleKey, type ArticleKeyRef } from "../../shared/article-key";
import { safeClick, safeKey, safePress } from "./lib/safe-click";
import { htmlToText } from "../../shared/markdown-safe";
import { hasTocHeadings } from "../../shared/toc";
import { installFilePickerGuard, type FilePickerGuard } from "../../shared/file-picker-guard";
import {
  STORAGE,
  type ArticlePayload,
  type DiagnoseResponse,
  type Message,
  type Selectors,
  type SelectorsResponse,
  type WhoAmIResponse,
} from "./lib/types";

const PENDING_TTL_MS = 10 * 60 * 1000;
/** ポップアップがタブを開いてから tabId を埋めるまでの猶予 */
const TAB_ID_WAIT_MS = 3_000;

// ポップアップからの診断要求。pending の有無に関係なく、note のどのページでも応える
chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse: (r: DiagnoseResponse) => void) => {
  if (msg?.type !== "diagnose") return;
  requestSelectors()
    .then(({ selectors }) => sendResponse({ ok: true, report: buildDiagnosticReport(selectors) }))
    .catch((e) => sendResponse({ ok: false, error: (e as Error).message }));
  return true; // 非同期で sendResponse する
});

main().catch((e) => banner(`エラー: ${(e as Error).message}`, "error"));

async function main() {
  const article = await getPendingForThisTab();
  if (!article) return;

  const { selectors: S, source } = await requestSelectors();

  if (new RegExp(S.loginUrlPattern).test(location.href)) {
    banner("note にログインしていません。ログインしてから、もう一度ポップアップから実行してください。", "error");
    return;
  }

  // エディタ以外のページ(トップ等)で動いてしまわないよう、タイトル欄が出るまで待つ。出なければ何もしない
  const titleEl = await waitFor(S.title, 15_000).catch(() => null);
  if (!titleEl) return;

  // 二重実行防止:ここで pending を消す(失敗しても再実行はポップアップから)
  await chrome.storage.local.remove(STORAGE.pendingArticle);

  banner(`入力中... (selectors: ${source})`);
  const results: string[] = [];
  // どの記事で始めたか。バナーのボタンを押したときに別の記事が開いていれば入れない。
  // 新規作成から始めたときは、保存で id が付いた時点でその id に固定する(別の記事に移ったあとで "new" が何にでも一致しないように)
  const keyRef: ArticleKeyRef = { key: articleKey(location.pathname) };
  watchArticleKey(keyRef);

  await step("タイトル", results, () => fillTitle(titleEl, article));
  // 目次は「カーソルのある行の次の行」に入るので、本文を貼る前の空の本文で入れ、本文はその下に貼る
  const tocRef: TocRef = { node: null };
  // 見出しが無い記事に目次を入れると中身の無い目次になるので、入れずに知らせる
  if (article.insertToc && !hasTocHeadings(article.html)) results.push("目次 —(見出しが無いので入れていません)");
  else if (article.insertToc) await step("目次", results, () => insertToc(S, tocRef));
  await step("本文", results, () => pasteBody(S, article, tocRef));
  if (article.images?.length || article.imageNotes?.length) await step("本文の画像", results, () => insertBodyImages(S, article));
  if (article.embedUrls) await step("埋め込み", results, () => embedUrlLines(S));
  const goOn = await step("見出し画像", results, () => setThumbnail(S, article));
  // 本文を貼ったり見出し画像を入れたりすると、画面が本文の途中や最後まで動く。確かめやすいよう、エディタのいちばん上に戻す
  scrollToTop(titleEl);
  const proceed = { label: "公開設定を入れる", onClick: () => runPublishSettings(S, article, results, keyRef) };
  if (!goOn) {
    // 見出し画像のアップロードを確認できないまま公開設定へ移ると、アップロードが途中で切れる可能性があるので、ここで止める
    banner(
      `⚠️ 見出し画像を確認できませんでした。画面で確かめてから「公開設定を入れる」を押してください。\n\n公開設定には進んでいません。\n${results.join("\n")}`,
      "warn",
      [proceed],
    );
    return;
  }
  if (!article.skipBodyReview) {
    // 本文を確認してから公開設定へ。公開設定を「キャンセル」で閉じるとハッシュタグとマガジンが note 側で消えるので、
    // 本文の確認・下書き保存・プレビューを先に済ませてもらう
    // 途中の工程(タイトル・本文など)が失敗していても step() は先へ進むので、ここで ✗ を見て文言と色を変える
    const failed = results.some((r) => r.includes("✗"));
    banner(
      (failed
        ? `⚠️ 一部は入力できませんでした。画面で確かめ、足りないものは手で入れてから「公開設定を入れる」を押してください。\n\n`
        : `✅ タイトル・本文・見出し画像を入れました。本文を確かめて、よければ「公開設定を入れる」を押してください。\n\n`) +
        `下書き保存・プレビューはこの画面で済ませてください。\n「公開設定を入れる」を押すと、拡張が「公開に進む」を押し、ハッシュタグとマガジンを入れて止まります。\n${results.join("\n")}`,
      failed ? "warn" : "ok",
      [proceed],
    );
    return;
  }
  await runPublishSettings(S, article, results, keyRef);
}

/**
 * 新規作成から始めたときに、保存で記事の id が付くのを見張って印を固定する(note は保存時に URL を /notes/<id>/edit に変える)。
 * 固定できたら見張りをやめる
 */
function watchArticleKey(ref: ArticleKeyRef): void {
  if (ref.key !== "new") return;
  const timer = setInterval(() => {
    lockArticleKey(ref, articleKey(location.pathname));
    if (ref.key !== "new") clearInterval(timer);
  }, 500);
}

/**
 * 「公開に進む」を押してハッシュタグとマガジンを入れ、「投稿する」の手前で止まる。
 * バナーの「公開設定を入れる」「もう一度入れる」からも呼ぶ(公開設定を「キャンセル」で閉じると note 側で消えるため)。
 * 先に済んだ工程の結果(before)はそのまま残し、公開設定の結果だけを付け直す
 */
async function runPublishSettings(S: Selectors, article: ArticlePayload, before: string[], keyRef: ArticleKeyRef) {
  // 始めたときと別の記事が開いていたら入れない(別の記事の公開設定を書き換えないため)。元の記事に戻れば同じボタンで続けられる
  const now = articleKey(location.pathname);
  lockArticleKey(keyRef, now);
  if (!isSameArticle(keyRef.key, now)) {
    banner(
      `⚠️ 入力を始めたときと別の記事が開いているので、公開設定は入れませんでした。\n元の記事に戻ってから、もう一度押してください。\n\n${before.join("\n")}`,
      "warn",
      [{ label: "もう一度入れる", onClick: () => runPublishSettings(S, article, before, keyRef) }],
    );
    return;
  }
  banner("公開設定を入力中...");
  const results = [...before];
  // ハッシュタグとマガジンは別の工程にする。マガジンが見つからなくても、ハッシュタグが入ったことは分かるように
  const opened = await step("公開設定", results, () => fillPublishSettings(S, article));
  const magazine = article.magazine;
  if (opened && magazine) await step("マガジン", results, () => selectMagazine(S, magazine));
  // 失敗した工程は、たたんだままでも読めるように見出しに出す(「詳細」の中だけだと気づけない)。
  // 工程名は外し、失敗の文言(複数行のこともある)をそのまま ⚠️ 付きで並べる
  const failed = results.filter((r) => r.includes(" ✗ ")).map((r) => r.slice(r.indexOf(" ✗ ") + 3));
  banner(
    (failed.length
      ? `${failed.map((m) => `⚠️ ${m}`).join("\n")}\n\n入ったものは画面で確かめ、足りないものは手で入れてから、「投稿する」を自分で押してください。\n`
      : `✅ 入力が終わりました。内容を確認して、「投稿する」を自分で押してください。\n\n`) +
      `「キャンセル」で戻ると、ハッシュタグとマガジンは note 側で消えます。\n直したあとは「もう一度入れる」を押してください。\n${results.join("\n")}`,
    failed.length ? "warn" : "ok",
    [{ label: "もう一度入れる", onClick: () => runPublishSettings(S, article, before, keyRef) }],
  );
}

/**
 * selectors は service worker に読んでもらう。content script は note.com の origin で動くので、
 * 同梱の selectors.json(chrome-extension://)も GitHub も自分では fetch できない("Failed to fetch" になる)
 */
async function requestSelectors(): Promise<Extract<SelectorsResponse, { ok: true }>> {
  const res = (await chrome.runtime.sendMessage({ type: "selectors" } satisfies Message).catch(() => null)) as SelectorsResponse | null;
  if (!res) throw new Error("拡張の service worker から応答がありません。chrome://extensions で拡張を再読み込みしてください。");
  if (!res.ok) throw new Error(`selectors を読めませんでした: ${res.error}`);
  return res;
}

/**
 * pending の記事が、このタブ(ポップアップが開いたタブ)向けのときだけ返す。
 * 別のタブ(既存の記事の編集など)では何もしない。
 */
async function getPendingForThisTab(): Promise<ArticlePayload | null> {
  const read = async () =>
    ((await chrome.storage.local.get(STORAGE.pendingArticle)) as { pendingArticle?: ArticlePayload })[STORAGE.pendingArticle] ?? null;

  let article = await read();
  if (!article) return null;
  if (Date.now() - article.createdAt > PENDING_TTL_MS) {
    await chrome.storage.local.remove(STORAGE.pendingArticle);
    return null;
  }

  // ポップアップがまだ tabId を埋めていなければ少し待つ。
  // 最初の読み取りとリスナー登録の間に書き込みが入ると取りこぼすので、リスナーを登録してから読み直す
  if (article.tabId === null) {
    article = await new Promise<ArticlePayload | null>((resolve) => {
      const done = (value: ArticlePayload | null) => {
        clearTimeout(timer);
        chrome.storage.onChanged.removeListener(onChange);
        resolve(value);
      };
      const timer = setTimeout(() => done(null), TAB_ID_WAIT_MS);
      function onChange(changes: Record<string, chrome.storage.StorageChange>, area: string) {
        const next = area === "local" ? (changes[STORAGE.pendingArticle]?.newValue as ArticlePayload | undefined) : undefined;
        if (next && next.tabId !== null) done(next);
      }
      chrome.storage.onChanged.addListener(onChange);
      void read().then((again) => {
        if (again && again.tabId !== null) done(again);
      });
    });
    if (!article) return null;
  }

  const me = (await chrome.runtime.sendMessage({ type: "whoami" } satisfies Message).catch(() => null)) as WhoAmIResponse | null;
  if (!me || me.tabId === null || me.tabId !== article.tabId) return null;
  return article;
}

/** エディタのいちばん上(タイトル欄)まで画面を戻す。ページ全体と、エディタを包むスクロールする箱のどちらにも効くようにする */
function scrollToTop(titleEl: HTMLElement) {
  titleEl.scrollIntoView({ block: "start", behavior: "auto" });
  window.scrollTo({ top: 0, behavior: "auto" });
}

// ---------------------------------------------------------------------------
// 各工程

function fillTitle(el: HTMLElement, a: ArticlePayload) {
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
type TocRef = { node: Element | null };

const TOC_MANUAL = "note の画面で、本文の先頭の行にカーソルを置き、左の「+」→「目次」を押してください";

/**
 * 空の本文の 1 行目にカーソルを置き、「+」(メニューを開く)→「目次」を押す。
 * 目次はカーソルのある行の次の行に入る(2026-11-10 実機)。入ったかは、本文の子要素が増えたかで確かめる。
 * 失敗しても下書きづくりは止めない(step が ✗ を記録して先へ進む)
 */
async function insertToc(S: Selectors, ref: TocRef) {
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
async function pasteBody(S: Selectors, a: ArticlePayload, toc: TocRef = { node: null }) {
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

/** contenteditable の中の target の先頭(または末尾)にカーソルを置く。エディタは selectionchange で自分の選択範囲に取り込む */
function placeCaret(root: HTMLElement, target: Node, where: "start" | "end") {
  const sel = window.getSelection();
  if (!sel || !root.contains(target)) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(where === "start");
  sel.removeAllRanges();
  sel.addRange(range);
}

/** セレクタに当たる要素のうち、画面に見えているもの(メニューの中身は閉じていると hidden) */
function visibleMatch(selector: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(selector)).find((e) => e.offsetParent !== null || e.getClientRects().length > 0) ?? null
  );
}

/** URL だけの行(段落)の文字。前後の空白は無視する */
const URL_LINE = /^https?:\/\/\S+$/;
/** 1 記事で埋め込みにする URL の行の上限(多すぎる記事で止まらないように) */
const MAX_EMBEDS = 20;
const EMBED_MANUAL = "note の画面で、その URL の行の末尾にカーソルを置いて Enter を押すと埋め込みになります";

/** 本文の直下にある、URL だけが書かれた段落 */
function urlLines(body: HTMLElement): HTMLElement[] {
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
async function embedUrlLines(S: Selectors) {
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
  if (skipped > 0) problems.push(`URL だけの行が ${all.length} 件あり、上限の ${MAX_EMBEDS} 件を超えた ${skipped} 件は埋め込みにしていません`);
  if (problems.length > 0) throw new Error(`${problems.join("。")}。${EMBED_MANUAL}`);
  return `${urls.length} 件`;
}

const IMAGE_MANUAL = "本文に残っている目印(［画像1・…: …］)の位置に、note の画面で画像を入れてください";

/**
 * 本文の目印(［画像1・ab12: image1.png］。ab12 は変換のたびに変わる印)を 1 つずつ選び、その画像のファイルを貼り付ける(#51)。
 * 2026-11-10 の実機で、貼り付けのイベントに画像のファイルを載せると、note がアップロードして本文に入れることを確かめた。
 * 入ったかは、新しい <img> が増えて、その src がアップロード後の https の URL になったかで確かめる
 */
async function insertBodyImages(S: Selectors, a: ArticlePayload) {
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
        `本文の画像を入れています(${i + 1}/${images.length} 枚目: ${img.name})\nnote のアップロードを待っています… ${sec} 秒(最大 ${formatWait(limit)})${pausedNote(paused)}`,
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
        `遅れて入る画像が無いかを確かめています(${pending.length} 枚)… ${Math.floor(clock.elapsed() / 1000)} 秒(最大 ${formatWait(LATE_UPLOAD_WAIT_MS)})${pausedNote(clock.paused())}`,
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
  if (captionFailed.length) problems.unshift(`キャプションを入れられなかった画像があります(${captionFailed.join(", ")}。note の画面で、画像の下の「キャプションを入力」に入れてください)`);
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
async function setImageCaption(body: HTMLElement, img: HTMLImageElement, caption: string): Promise<boolean> {
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

/** 本文の中で、text がそのまま入っている所(1 つのテキストの中)を探す */
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

/** contenteditable の中の target の末尾にカーソルを置く。エディタは selectionchange で自分の選択範囲に取り込む */
function caretToEnd(root: HTMLElement, target: Node) {
  const sel = window.getSelection();
  if (!sel || !root.contains(target)) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

async function setThumbnail(S: Selectors, a: ArticlePayload) {
  if (!a.thumbnail) return "なし";
  const file = base64ToFile(a.thumbnail);

  // note がファイル選択ダイアログ(Finder など)を開こうとしたら止めて、その input に画像を渡す。
  // 拡張のクリックは合成イベントなのでふつうは開かないが、人が直前にタブを触っているとブラウザが開いてしまう
  const guard = installFilePickerGuard();
  try {
    return await setThumbnailGuarded(S, file, guard);
  } finally {
    guard.stop();
  }
}

async function setThumbnailGuarded(S: Selectors, file: File, guard: FilePickerGuard) {
  // (1) file input が DOM にあれば直接セット(hidden でも可)
  let input = document.querySelector<HTMLInputElement>(S.thumbnail.fileInput);
  if (!input) {
    // (2) 見出し画像のボタンを押すとメニューと一緒に file input が出てくる(実機: #note-editor-eyecatch-input は
    //     メニューを開いたときだけ DOM にある)。ボタンは selectors の指定 → 文字 → タイトル欄の上のアイコンボタンの順で探す
    const title = document.querySelector<HTMLElement>(S.title);
    const btn =
      document.querySelector<HTMLElement>(S.thumbnail.addButton) ??
      findByText("button", S.thumbnail.addButtonText) ??
      (title ? findEyecatchButton(title) : null);
    if (!btn) throw new Error("見出し画像のボタンが見つかりません。手動で設定してください(「DOM 情報を取得」の結果を送ってもらえれば直せます)。");
    input = await activateEyecatchButton(S, btn, guard);
  }

  // 確定ボタン(「保存」)は、画像を入れたあとに新しく現れたものだけを押す。
  // 画面にもとからある「保存」(例: 下書き保存)は完全一致でも押さないよう、入れる前の一覧を控えておく
  const confirmBefore = new Set(findAllByText("button", S.thumbnail.confirmText));

  const imagesBefore = new Set(Array.from(document.querySelectorAll("img, canvas")));
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  // トリミング確認が出たら、その中(ダイアログ内、または新しく現れた)の確定ボタンだけを押す
  const confirm = await waitForConfirm(S.thumbnail.confirmText, confirmBefore, 20_000);
  if (!confirm) throw new StopError("画像は渡しました。トリミングの「保存」が見つからないので、出ていれば自分で押してください");

  // 「保存」が現れた直後は画像がまだ読み込まれていないことがある(実機: ✓ なのに記事に画像が付かなかった)。
  // 渡した画像がダイアログ(無ければページ)に表示されるまで待ってから押す。表示されなければ押さない
  // 回線やサーバーの調子で時間が変わるので、待ち時間は長めに取る
  const dialog = confirm.closest<HTMLElement>('dialog, [role="dialog"], [aria-modal="true"]');
  const freshImage = (root: ParentNode) =>
    Array.from(root.querySelectorAll<HTMLImageElement | HTMLCanvasElement>("img, canvas"))
      .filter((el) => !imagesBefore.has(el))
      .find((el) => (el instanceof HTMLImageElement ? el.complete && el.naturalWidth > 0 : canvasHasContent(el))) ?? null;
  const loaded = await waitUntil(() => freshImage(dialog ?? document), 30_000);
  if (!loaded) {
    // トリミング画面が開いたままの可能性があるので、後続(公開設定への移動)には進まない
    throw new StopError("画像は渡しましたが、トリミング画面に画像が表示されないので「保存」は押していません。表示されていれば自分で押してください");
  }
  await sleep(1_000); // 描画が落ち着くまで
  const label = (confirm.textContent ?? "").trim();
  const cr = confirm.getBoundingClientRect();
  safePress(confirm, "setThumbnail.confirm", { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 }).release({ click: true });

  // 「保存」のあとはアップロードが走る。トリミング画面が閉じて、記事側に見出し画像が表示されるまで待ってから次へ進む
  // (すぐ公開設定へ移るとアップロードが途中で切れる可能性がある)
  const shown = await waitUntil(() => {
    const dialogOpen = dialog ? dialog.isConnected : Boolean(findDialog());
    if (dialogOpen) return null;
    return freshImage(document);
  }, 60_000);
  if (!shown) {
    throw new StopError(
      `トリミングの「${label}」は押しましたが、記事側に見出し画像が表示されるのを確認できませんでした(アップロードが遅いか失敗した可能性)`,
    );
  }
  await sleep(1_500); // 保存処理が落ち着くまで
  return `トリミングの「${label}」を押し、見出し画像が表示されました`;
}

/**
 * 見出し画像のボタンを押してメニューを開き、画像の file input を返す。
 * 実機(test11)では正しいボタンに pointerdown → click を送ってもメニューが開かなかったので、実際の操作に近い順で試す:
 * (1) ボタンの中心にある要素(重なっている要素があればそれ)に hover → pointerdown → mousedown、(2) 続けて click、
 * (3) Enter キー、(4) Space キー。それぞれの後で「入力欄」か「メニューの『画像をアップロード』」が出たかを見る。
 * メニューが出たら「画像をアップロード」を押す(入力欄はこのときに作られる可能性がある。ファイル選択ダイアログは
 * ユーザー操作なしでは開かないので、出た入力欄にファイルを直接入れる)。
 * 出なければ、どこまで試して何が起きたかをエラー文に出す(バナーのスクリーンショットだけで次の手を決めるため)
 */
async function activateEyecatchButton(S: Selectors, btn: HTMLElement, guard: FilePickerGuard): Promise<HTMLInputElement> {
  // ダイアログを止めたときの input(note がまさに使おうとしたもの)を優先し、無ければセレクタで探す
  const fileInput = () => guard.input() ?? document.querySelector<HTMLInputElement>(S.thumbnail.fileInput);
  const menuItem = () => findSmallestByText(S.thumbnail.uploadMenuText, S.body);
  const appeared = (ms: number) => waitUntil(() => fileInput() ?? menuItem(), ms);
  const log: string[] = [];

  const r = btn.getBoundingClientRect();
  const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  // 中心にあるのが SVG(click() が無い)などなら、ボタン自身に送る(子からのイベントと同じくボタンのハンドラに届く)
  const atPoint = document.elementFromPoint(at.x, at.y);
  const target = atPoint instanceof HTMLElement && (btn.contains(atPoint) || atPoint.contains(btn)) ? atPoint : btn;
  if (atPoint && atPoint !== btn) log.push(`中心の要素: ${describe(atPoint as HTMLElement)}${target === btn ? "(ボタンの外なので、ボタン自身に送る)" : ""}`);

  // 押している間に DOM へ新しく現れた要素を記録する(メニューが開いたのに見つけられていないのか、開いていないのかを切り分ける)
  const added: HTMLElement[] = [];
  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of Array.from(rec.addedNodes)) {
        if (node instanceof HTMLElement && node.id !== "lastclick-pigeon-banner") added.push(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  btn.focus();
  log.push(`focus→${document.activeElement === btn ? "ボタン" : describe((document.activeElement as HTMLElement | null) ?? document.body)}`);
  const press = safePress(target, "setThumbnail.addButton", at);
  let hit = await appeared(500);
  log.push(`pointer→${hit ? "出た" : "なし"}`);
  press.release({ click: !hit });
  if (!hit) {
    hit = await appeared(1_000);
    log.push(`click→${hit ? "出た" : "なし"}`);
  }
  for (const key of ["Enter", " "] as const) {
    if (hit) break;
    safeKey(btn, "setThumbnail.addButton", key);
    hit = await appeared(1_000);
    log.push(`${key === " " ? "Space" : key}→${hit ? "出た" : "なし"}`);
  }
  observer.disconnect();
  if (guard.input()) log.push("ファイル選択ダイアログを止めた");
  const shown = added.filter((el) => el.isConnected).slice(0, 12);
  log.push(shown.length ? `現れた要素(${added.length} 件): ${shown.map((el) => describeShort(el)).join(" | ")}` : "現れた要素: なし");

  let input = fileInput();
  if (!input) {
    const item = menuItem();
    if (item) {
      // 見出し画像のボタンと同じく、実際の操作と同じ順(hover → pointerdown → … → click)で押す
      const ir = item.getBoundingClientRect();
      safePress(item, "setThumbnail.uploadMenu", { x: ir.left + ir.width / 2, y: ir.top + ir.height / 2 }).release({ click: true });
      log.push(`メニュー「${S.thumbnail.uploadMenuText[0]}」を押した`);
      input = await waitUntil(fileInput, 5_000);
    } else {
      log.push(`メニュー「${S.thumbnail.uploadMenuText[0]}」なし`);
    }
  }
  if (!input) {
    throw new Error(
      `見出し画像のボタンを押しましたが、画像の入力欄が出ませんでした。手動で設定してください。` +
        `経過: ${log.join(" / ")}。押したボタン: ${rect(btn)} ${describe(btn)}`,
    );
  }
  return input;
}

/** 確定ボタン: 開いているダイアログの中、または `before` に無かった新しいボタンが現れるまで待つ */
function waitForConfirm(texts: string[], before: Set<HTMLElement>, timeout: number): Promise<HTMLElement | null> {
  const find = () => {
    const dialog = findDialog();
    const inDialog = dialog ? findByText("button", texts, dialog) : null;
    if (inDialog) return inDialog;
    return findAllByText("button", texts).find((b) => !before.has(b)) ?? null;
  };
  return new Promise((resolve) => {
    const found = find();
    if (found) return resolve(found);
    const obs = new MutationObserver(() => {
      const el = find();
      if (el) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => {
      obs.disconnect();
      resolve(null);
    }, timeout);
  });
}

async function fillPublishSettings(S: Selectors, a: ArticlePayload) {
  // 公開設定がまだ開いていなければ「公開に進む」を押す(「もう一度入れる」を公開設定の画面で押した場合は開いている)
  if (!document.querySelector(S.publishSettings.hashtagInput)) {
    const open = findByText("button", S.openPublishSettingsText);
    if (!open) throw new Error("「公開に進む」ボタンが見つかりません。");
    safeClick(open, "fillPublishSettings.open");
  }

  const tagInput = await waitFor<HTMLInputElement>(S.publishSettings.hashtagInput, 10_000);
  for (const tag of a.hashtags) {
    tagInput.focus();
    setNativeValue(tagInput, tag);
    tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    tagInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
    await sleep(200);
  }

  // 公開ボタンは「あるかどうか」を見るだけ。絶対にクリックしない。
  if (!findByText("button", S.publishSettings.publishButtonText)) throw new Error("公開ボタンが見つかりません(画面構成が変わった可能性)。");
}

/** 公開設定の画面でマガジンを選ぶ。名前が一致する行が無ければ、直し方を添えて失敗にする */
async function selectMagazine(S: Selectors, magazine: string) {
  // 「マガジン」の切り替えは、まだオンでないときだけ押す(実機では最初からオン。押すとオフになって一覧が消える)
  const toggle = findByText("button", S.publishSettings.magazineToggleText);
  if (toggle && !isToggledOn(toggle)) {
    safeClick(toggle, "fillPublishSettings.magazineToggle");
    await sleep(300);
  }
  // (1) label / option 形式(名前そのものを押す)
  const item = Array.from(document.querySelectorAll<HTMLElement>(S.publishSettings.magazineItem)).find(
    (el) => el.textContent?.trim() === magazine,
  );
  if (item) {
    // 「もう一度入れる」で再実行したときに、選択済みのものを押して外さない
    if (!isSelected(item)) safeClick(item, "fillPublishSettings.magazineItem");
    return;
  }
  // (2) 実機の形式: マガジン名の行に「追加」ボタンがある。名前の行の中だけを見る(別の行の「追加」は押さない)
  const row = findMagazineRowButton(magazine, S.publishSettings.magazineAddButtonText);
  if (!row.rowFound) {
    throw new Error(
      `マガジン「${magazine}」が note にありません。\nmd の magazine と note のマガジン名が同じか確かめてください。\n(画面で手で選ぶか、md を直して作り直してください)`,
    );
  }
  if (row.button) {
    if (!isToggledOn(row.button)) safeClick(row.button, "fillPublishSettings.magazineAdd");
    return;
  }
  return `「追加」が無いので押していません(追加済みの可能性)`;
}

// ---------------------------------------------------------------------------
// ユーティリティ

/** 工程を途中で止めるべきときに投げる(後続の工程に進まない)。普通のエラーは記録して次へ進む */
class StopError extends Error {}

/** 工程を 1 つ実行して結果を記録する。後続に進んでよければ true、StopError なら false */
async function step(name: string, results: string[], fn: () => Promise<unknown> | unknown): Promise<boolean> {
  // いま何をしているかをバナーに出す(待ちが長いときに、固まったと思わないように)
  bannerStatus(`${name}を入れています…`);
  try {
    const r = await fn();
    results.push(`${name} ✓${typeof r === "string" ? `(${r})` : ""}`);
    return true;
  } catch (e) {
    results.push(`${name} ✗ ${(e as Error).message}`);
    console.warn(`[lastclick-pigeon] ${name}:`, e);
    return !(e instanceof StopError);
  }
}

function waitFor<T extends HTMLElement = HTMLElement>(selector: string, timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const found = document.querySelector<T>(selector);
    if (found) return resolve(found);
    const obs = new MutationObserver(() => {
      const el = document.querySelector<T>(selector);
      if (el) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      obs.disconnect();
      reject(new Error(`要素が見つかりません: ${selector}`));
    }, timeout);
  });
}

/**
 * 文言でボタン等を探す(class 名より文言のほうが変わりにくい)。
 * 部分一致ではなく、正規化後の完全一致(textContent か aria-label)。`scope` を渡すとその中だけを探す
 */
/** 文字が候補のどれかに完全一致するボタン等をすべて返す */
function findAllByText(tag: string, texts: string[], scope: ParentNode = document): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(tag)).filter((el) =>
    matchesAnyText([el.textContent, el.getAttribute("aria-label")], texts),
  );
}

/**
 * 文字が候補に(正規化後)完全一致する最小の要素を探し、その押せる祖先(button / menuitem / option / a / li)を返す。
 * メニュー項目のように「文字 + 補足」で組まれていて、ボタン全体の文字では一致しないものを押すため。
 * excludeSelector(記事本文など)と contenteditable の中は対象にしない
 */
function findSmallestByText(texts: string[], excludeSelector: string): HTMLElement | null {
  // 実機のメニュー項目は「画像をアップロード」の文字と「推奨サイズ: …」が同じ要素に直接入っていて、
  // 文字が完全一致する要素が無い(test13 で確認)。そこで「文字を含む最小の要素」にする
  const norm = texts.map(normalizeLabel).filter((t) => t !== "");
  const contains = (el: Element) => {
    const t = normalizeLabel(el.textContent ?? "");
    return norm.some((n) => t.includes(n));
  };
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    if (!contains(el)) continue;
    if (el.closest(`[contenteditable="true"], textarea, ${excludeSelector}`)) continue; // 記事本文に同じ文字があっても押さない
    if (Array.from(el.children).some(contains)) continue; // より小さい子がある
    return el.closest<HTMLElement>('button, [role="menuitem"], [role="option"], a, li') ?? el;
  }
  return null;
}

/**
 * canvas に何か描かれているか。幅があるだけでは証拠にならない(未指定でも既定値 300)ので、
 * 画素を間引いて読み、透明でなく単色でもなければ描画済みとみなす。読めなければ(汚染など)false
 */
function canvasHasContent(c: HTMLCanvasElement): boolean {
  try {
    const ctx = c.getContext("2d");
    if (!ctx || c.width === 0 || c.height === 0) return false;
    const seen = new Set<string>();
    for (let y = 0; y < c.height; y += Math.max(1, Math.floor(c.height / 8))) {
      for (let x = 0; x < c.width; x += Math.max(1, Math.floor(c.width / 8))) {
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
        if (a > 0) seen.add(`${r},${g},${b},${a}`);
      }
    }
    return seen.size >= 2;
  } catch {
    return false;
  }
}

/** 要素の短い説明(タグ・id・role・文字の先頭)。「現れた要素」の一覧用 */
function describeShort(el: HTMLElement): string {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const role = el.getAttribute("role");
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${role ? `[role=${role}]` : ""}${text ? ` "${text.slice(0, 30)}${text.length > 30 ? "…" : ""}"` : ""}`;
}

/** fn が null 以外を返すまで 250 ms おきに試す(timeout で null) */
async function waitUntil<T>(fn: () => T | null, timeout: number): Promise<T | null> {
  const until = Date.now() + timeout;
  for (;;) {
    const r = fn();
    if (r !== null) return r;
    if (Date.now() >= until) return null;
    await sleep(250);
  }
}

/**
 * waitUntil と同じ。待っているあいだ、1 秒ごとに経過した秒数をバナーに出す。
 * note のダイアログなどでページが止まっていた時間は、待ち時間に数えない(shared/active-clock.ts)
 */
async function waitWithStatus<T>(fn: () => T | null, timeout: number, status: (sec: number, pausedMs: number) => string): Promise<T | null> {
  const clock: ActiveClock = activeClock();
  const show = () => bannerStatus(status(Math.floor(clock.elapsed() / 1000), clock.paused()));
  show();
  const timer = setInterval(show, 1000);
  try {
    for (;;) {
      const r = fn();
      if (r !== null) return r;
      if (clock.elapsed() >= timeout) return null;
      await sleep(250);
    }
  } finally {
    clearInterval(timer);
  }
}

/** 止まっていた時間があれば、数えていないことを添える */
function pausedNote(ms: number): string {
  return ms >= 1_000 ? `\nダイアログなどで止まっていた ${Math.round(ms / 1000)} 秒は、待ち時間に数えていません` : "";
}

/** 120000 → 「2 分」、30000 → 「30 秒」 */
function formatWait(ms: number): string {
  return ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} 分` : `${Math.round(ms / 1000)} 秒`;
}

function findByText(tag: string, texts: string[], scope: ParentNode = document): HTMLElement | null {
  const all = Array.from(scope.querySelectorAll<HTMLElement>(tag));
  for (const t of texts) {
    const hit = all.find((el) => matchesAnyText([el.textContent, el.getAttribute("aria-label")], [t]));
    if (hit) return hit;
  }
  return null;
}

/** トグル / チェックボックス風のボタンがオンか(aria-checked / aria-pressed / data-active) */
function isToggledOn(el: HTMLElement): boolean {
  return ["aria-checked", "aria-pressed", "data-active"].some((attr) => el.getAttribute(attr) === "true");
}

/** label(中のチェックボックス)や option が選択済みか */
function isSelected(el: HTMLElement): boolean {
  if (isToggledOn(el) || el.getAttribute("aria-selected") === "true") return true;
  if (el instanceof HTMLOptionElement) return el.selected;
  const input = el instanceof HTMLInputElement ? el : el.querySelector<HTMLInputElement>("input[type=checkbox], input[type=radio]");
  return Boolean(input?.checked);
}

/** 開いているダイアログ(モーダル)。無ければ null */
function findDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('dialog[open], [role="dialog"], [aria-modal="true"]');
}

/** React / Vue 管理下の input に値を入れて、フレームワーク側に変更を気づかせる */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function base64ToFile(t: { name: string; mimeType: string; base64: string }): File {
  const bin = atob(t.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], t.name, { type: t.mimeType });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type BannerAction = { label: string; onClick: () => Promise<void> | void };

/**
 * 画面右下に進捗を出す。note の DOM を汚さないよう shadow DOM に閉じる。
 * text の 1 行目だけを出し、2 行目以降は「詳細」を押したときに開く(本文の確認の邪魔にならないように)。
 * 「たたむ」で小さなピルにし、押すと戻る。actions を渡すとボタンを出す(押すとボタンを無効にして onClick を呼ぶ。失敗はエラーのバナーにする)
 */
function banner(text: string, kind: "info" | "ok" | "warn" | "error" = "info", actions: BannerAction[] = []) {
  let host = document.getElementById("lastclick-pigeon-banner");
  if (!host) {
    host = document.createElement("div");
    host.id = "lastclick-pigeon-banner";
    document.body.appendChild(host);
    host.attachShadow({ mode: "open" });
  }
  const colors = { info: "#2d6cdf", ok: "#1f9d7a", warn: "#c27c0e", error: "#c0392b" };
  // 空行(\n\n)より前が常に見える部分(複数行でもよい)、後ろが「詳細」で開く部分
  const sep = text.indexOf("\n\n");
  const summary = sep < 0 ? text : text.slice(0, sep);
  const details = sep < 0 ? "" : text.slice(sep + 2).trim();
  // 文字リンク風のボタン(キーボードでも操作できるように button にする)
  const link = `border:0;padding:0;background:none;color:#fff;cursor:pointer;opacity:.85;font:13px system-ui,sans-serif;text-decoration:underline;text-underline-offset:3px`;
  const buttons = actions
    .map(
      (a, i) =>
        `<button type="button" data-action="${i}" style="padding:6px 12px;border:0;border-radius:6px;
          background:#fff;color:${colors[kind]};font:600 13px system-ui,sans-serif;cursor:pointer">${escapeHtml(a.label)}</button>`,
    )
    .join("");
  // 進めているあいだ(ボタンの無いお知らせ)は、くるくる回る印を出す(止まっていないことが分かるように)
  const working = kind === "info" && actions.length === 0;
  // 進めているあいだは、操作を控えてもらう。拡張が文字を選んで画像を貼ったり、目印を消したりしている途中に
  // 文字を打ったりクリックしたりすると、目印が残ったり、違う場所に入ったりする。note のダイアログ(OK を押すもの)だけは押してもらう
  // (この関数は main() から最初の await より前に呼ばれるので、文はファイルの先頭の const にせず、ここに置く)
  const waitNotice = "処理中です。終わるまで、この画面は操作せずにお待ちください(note のダイアログが出たときは「OK」を押してください)";
  const spin = (size: number) =>
    working
      ? `<span class="spin" aria-hidden="true" style="display:inline-block;width:${size}px;height:${size}px;margin-right:6px;vertical-align:-1px;
          border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:loc-spin .9s linear infinite"></span>`
      : "";
  host.shadowRoot!.innerHTML = `
    <style>@keyframes loc-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.spin{animation-duration:3s}}</style>
    <div id="box" style="position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:440px;padding:12px 16px;
      border-radius:10px;background:${colors[kind]};color:#fff;font:14px/1.6 system-ui,sans-serif;
      box-shadow:0 4px 16px rgba(0,0,0,.25)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px"><b>${spin(12)}Last One Click</b><button type="button" id="min" aria-label="バナーをたたむ" style="${link}">たたむ</button></div>
      ${working ? `<div id="wait" style="margin-bottom:6px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,.18);font-size:13px">${escapeHtml(waitNotice)}</div>` : ""}
      <div id="sum" style="white-space:pre-wrap">${escapeHtml(summary ?? "")}</div>
      ${details ? `<div id="det" hidden style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.3);font-size:13px;opacity:.95;white-space:pre-wrap">${escapeHtml(details)}</div>` : ""}
      <div style="margin-top:10px;display:flex;align-items:center;justify-content:flex-end;gap:12px">${details ? `<button type="button" id="tog" aria-expanded="false" aria-controls="det" style="${link}">詳細</button>` : ""}${buttons}</div>
    </div>
    <button type="button" id="pill" hidden aria-label="Last One Click のバナーを開く" style="position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:6px 12px;border:0;border-radius:999px;
      background:${colors[kind]};color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25)">${spin(10)}Last One Click ▴</button>`;
  const root = host.shadowRoot!;
  const box = root.getElementById("box")!;
  const pill = root.getElementById("pill")!;
  root.getElementById("min")!.onclick = () => {
    box.hidden = true;
    pill.hidden = false;
    pill.focus();
  };
  pill.onclick = () => {
    pill.hidden = true;
    box.hidden = false;
    root.getElementById("min")!.focus();
  };
  const tog = root.getElementById("tog");
  const det = root.getElementById("det");
  if (tog && det) {
    tog.onclick = () => {
      det.hidden = !det.hidden;
      tog.textContent = det.hidden ? "詳細" : "詳細を閉じる";
      tog.setAttribute("aria-expanded", String(!det.hidden));
    };
  }
  root.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((b) => {
    b.onclick = () => {
      root.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((x) => (x.disabled = true));
      Promise.resolve(actions[Number(b.dataset.action)]!.onClick()).catch((e) => banner(`エラー: ${(e as Error).message}`, "error"));
    };
  });
}

/**
 * 進めているあいだのお知らせの文だけを書き換える(バナーを作り直さないので、「たたむ」で小さくしたままにできる)。
 * 進めている途中のバナーが無いとき(ボタンや結果を出しているときなど)は、新しく出す
 */
function bannerStatus(text: string) {
  const root = document.getElementById("lastclick-pigeon-banner")?.shadowRoot;
  const sum = root?.getElementById("sum");
  if (sum && root?.querySelector(".spin")) sum.textContent = text;
  else banner(text);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
