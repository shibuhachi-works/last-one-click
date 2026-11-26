// note.com のタブで動く content script。
// chrome.storage に pending の記事があれば、エディタに入力して公開ボタンの手前で止まる。
// ログイン状態はこのタブのものをそのまま使う(拡張は Cookie に触らない)。
import { buildDiagnosticReport } from "./lib/diagnose";
import { articleKey, isSameArticle, lockArticleKey, type ArticleKeyRef } from "../../shared/article-key";
import { hasTocHeadings } from "../../shared/toc";
import { diagnoseCurrentUser, fetchCurrentUser, type CurrentUser } from "../../shared/current-user";
import { checkNoteAccount, noteAccountMismatchMessage, noteAccountUnknownMessage } from "../../shared/note-account";
import { REWRITE_UNDO_NOTE, checkNoteUrl, noteEditKey, noteUrlProblem, rewriteSkippedLines } from "../../shared/note-rewrite";
import { STORAGE, type AccountResponse, type ArticlePayload, type DiagnoseResponse, type Message, type NoteArticleResponse, type NoteRewriteResponse, type Selectors, type SelectorsResponse, type WhoAmIResponse } from "./lib/types";
import { clearBody, scrollToTop, fillTitle, type TocRef, insertToc, pasteBody, embedUrlLines, insertBodyImages } from "./lib/content/editor-steps";
import { setThumbnail } from "./lib/content/eyecatch";
import { fillPublishSettings, setPaidPrice, setPaywallLine, selectMagazine } from "./lib/content/publish-settings";
import { step, banner } from "./lib/content/banner";
import { waitFor } from "./lib/content/dom";

const PENDING_TTL_MS = 10 * 60 * 1000;
/** 工程の結果に入れる、アカウントを確かめられなかったときの行の名前(#102) */
const ACCOUNT_STEP = "アカウント";
/** ポップアップがタブを開いてから tabId を埋めるまでの猶予 */
const TAB_ID_WAIT_MS = 3_000;

// ポップアップからの診断要求。pending の有無に関係なく、note のどのページでも応える
chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse: (r: DiagnoseResponse | AccountResponse | NoteArticleResponse | NoteRewriteResponse) => void) => {
  if (msg?.type === "diagnose") {
    requestSelectors()
      .then(async ({ selectors }) => {
        // ログイン中のユーザーの問い合わせ(#106)も 1 回だけ行い、応答の有無・状態・道筋と文字数だけを出す
        const currentUser = await diagnoseCurrentUser(selectors.account, location.origin);
        sendResponse({ ok: true, report: buildDiagnosticReport(selectors, currentUser) });
      })
      .catch((e) => sendResponse({ ok: false, error: (e as Error).message }));
    return true; // 非同期で sendResponse する
  }
  if (msg?.type === "account") {
    // ポップアップを開いたときに 1 回だけ来る。読めなければ null(ポップアップには何も出さない)
    requestSelectors()
      .then(({ selectors }) => readAccount(selectors))
      .catch(() => null)
      .then((account) => sendResponse({ account }));
    return true;
  }
  if (msg?.type === "noteArticle") {
    // 書き換える前の確かめ(#174)。開いている記事の ID と、タイトルの欄の今の文字を返すだけ(書き込まない)
    requestSelectors()
      .then(({ selectors }) => readTitleText(selectors))
      .catch(() => "")
      .then((title) => sendResponse({ key: noteEditKey(location.href), title }));
    return true;
  }
  if (msg?.type === "noteRewrite") {
    // ポップアップが、このタブ向けの pending(書き換え)を置いてから送ってくる(#174)。ページは読み込み直さない
    if (running) {
      sendResponse({ ok: false, error: "このページでは、もう入れている途中です。終わるまで待ってください。" });
      return;
    }
    sendResponse({ ok: true });
    void run();
    return;
  }
});

/** 入れている途中か(読み込み時と、書き換えの知らせで 2 回動かないように) */
let running = false;

async function run() {
  if (running) return;
  running = true;
  try {
    await main();
  } catch (e) {
    banner(`エラー: ${(e as Error).message}`, "error");
  } finally {
    running = false;
  }
}

/** タイトルの欄の今の文字(#174)。読めなければ空 */
function readTitleText(S: Selectors): string {
  const el = document.querySelector<HTMLElement>(S.title);
  if (!el) return "";
  const v = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : (el.textContent ?? "");
  return v.replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * ログイン中の note アカウント(#106)。読めなければ null。投げない。
 * 名前・ID・アイコンの URL は、バナーやポップアップに出すだけ。保存しない・外へ送らない
 */
function readAccount(S: Selectors): Promise<CurrentUser | null> {
  return fetchCurrentUser(S.account, location.origin).catch(() => null);
}

void run();

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

  // 記事が note_account を指定していれば、工程を始める前にログイン中のアカウントと比べる(#102)。
  // 違えば何も入れずに止める。読めなければ止めずに進み、バナーで注意する。指定が無ければ比べない(今までどおり)
  const results: string[] = [];
  let checkedAccount: CurrentUser | null | undefined;
  if (article.noteAccount) {
    banner("ログイン中のアカウントを確かめています...");
    checkedAccount = await readAccount(S);
    const check = checkNoteAccount(article.noteAccount, checkedAccount);
    if (check.kind === "mismatch") {
      banner(`⚠️ ${noteAccountMismatchMessage(check)}\n\nタイトル・本文などは入れていません。`, "error");
      return;
    }
    if (check.kind === "unknown") results.push(`${ACCOUNT_STEP} ⚠️ ${noteAccountUnknownMessage(check)}`);
  }

  if (article.rewriteKey) {
    await rewriteArticle(S, article, titleEl, results, checkedAccount ?? null, source);
    return;
  }

  banner(`入力中... (selectors: ${source})`);
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
  // 入れ終えたので、どのアカウントで作ったかを 1 回だけ読む(#106)。読めなければ出さない。公開設定まで一気に進むときは、そちらで読む
  // 先にアカウントを確かめて読めていれば、それを使う(同じ問い合わせを 2 回しない)
  const account = article.skipBodyReview && goOn ? null : (checkedAccount ?? (await readAccount(S)));
  if (!goOn) {
    // 見出し画像のアップロードを確認できないまま公開設定へ移ると、アップロードが途中で切れる可能性があるので、ここで止める
    banner(
      accountWarning(results) +
        `⚠️ 見出し画像を確認できませんでした。画面で確かめてから「公開設定を入れる」を押してください。\n\n公開設定には進んでいません。\n${results.join("\n")}`,
      "warn",
      [proceed],
      account,
    );
    return;
  }
  if (!article.skipBodyReview) {
    // 本文を確認してから公開設定へ。公開設定を「キャンセル」で閉じるとハッシュタグとマガジンが note 側で消えるので、
    // 本文の確認・下書き保存・プレビューを先に済ませてもらう
    // 途中の工程(タイトル・本文など)が失敗していても step() は先へ進むので、ここで ✗ を見て文言と色を変える
    const failed = results.some((r) => r.includes("✗"));
    banner(
      accountWarning(results) +
        (failed
          ? `⚠️ 一部は入力できませんでした。画面で確かめ、足りないものは手で入れてから「公開設定を入れる」を押してください。\n\n`
          : `✅ タイトル・本文・見出し画像を入れました。本文を確かめて、よければ「公開設定を入れる」を押してください。\n\n`) +
        `下書き保存・プレビューは、note の編集画面で済ませてください。\n「公開設定を入れる」を押すと、拡張が「公開に進む」を押し、ハッシュタグとマガジンを入れて止まります。\n${results.join("\n")}`,
      failed ? "warn" : "ok",
      [proceed],
      account,
    );
    return;
  }
  await runPublishSettings(S, article, results, keyRef);
}

/**
 * 開いている記事の編集画面を、md の内容で書き換える(#174)。
 * タイトル・本文(今の本文を消してから)・目次・本文の画像・埋め込み・見出し画像を入れて止まる。
 * 公開設定の画面に移ると記事が保存される可能性があるので、「公開に進む」は押さず、公開設定(ハッシュタグ・マガジン・価格・有料ライン)は入れない。
 * 「更新する」「下書き保存」も押さない。保存せずに閉じれば、記事は変わらない
 */
async function rewriteArticle(S: Selectors, article: ArticlePayload, titleEl: HTMLElement, results: string[], account: CurrentUser | null, source: string) {
  const open = articleKey(location.pathname);
  if (open !== article.rewriteKey) {
    banner(`⚠️ 書き換えを始めたときと別の記事が開いているので、何も入れていません。\n書き換えたい記事の編集画面で、もう一度ポップアップから押してください。`, "error");
    return;
  }
  const problem = noteUrlProblem(checkNoteUrl(article.noteUrl, open));
  if (problem) {
    banner(`⚠️ ${problem}\n\nタイトル・本文などは入れていません。`, "error");
    return;
  }

  banner(`書き換え中... (selectors: ${source})`);
  const keyRef: ArticleKeyRef = { key: open };
  await step("タイトル", results, () => fillTitle(titleEl, article));
  // 今の本文を消せなかったら、本文の工程(目次・本文・画像・埋め込み)は入れない(前の本文と混ざらないように)
  const cleared = await step("今の本文を消す", results, () => clearBody(S));
  if (cleared) {
    const tocRef: TocRef = { node: null };
    if (article.insertToc && !hasTocHeadings(article.html)) results.push("目次 —(見出しが無いので入れていません)");
    else if (article.insertToc) await step("目次", results, () => insertToc(S, tocRef));
    await step("本文", results, () => pasteBody(S, article, tocRef));
    if (article.images?.length || article.imageNotes?.length) await step("本文の画像", results, () => insertBodyImages(S, article));
    if (article.embedUrls) await step("埋め込み", results, () => embedUrlLines(S));
  } else {
    results.push("本文 —(今の本文を消せなかったので、入れていません。本文は手で入れ替えてください)");
  }
  // 見出し画像は、ボタンを selectors の指定か文字で見つけたときだけ入れる(位置で探すと、すでにある見出し画像の
  // 「削除」などのアイコンを押すおそれがあるため)
  await step("見出し画像", results, () => setThumbnail(S, article, { guessButton: false }));
  scrollToTop(titleEl);
  // 入れ終えたあとで別の記事に移っていたら(keyRef と違えば)、知らせだけ変える。拡張はこのあと何も押さない
  const moved = !isSameArticle(keyRef.key, articleKey(location.pathname));

  const failed = results.some((r) => r.includes("✗"));
  const skipped = rewriteSkippedLines(article);
  banner(
    accountWarning(results) +
      (moved ? "⚠️ 入れている途中で、別の記事に移りました。書き換えた記事を開いて確かめてください。\n\n" : "") +
      (failed
        ? `⚠️ 一部は書き換えられませんでした。画面で確かめ、足りないものは手で直してください。\n\n`
        : `✅ タイトル・本文・見出し画像を、md の内容に書き換えました。\n\n`) +
      `中身を確かめて、よければ自分で保存してください(公開済みの記事は「公開に進む」→「更新する」、下書きは「下書き保存」)。\n${REWRITE_UNDO_NOTE}\n` +
      (skipped.length
        ? `\n書き換えでは、公開設定(ハッシュタグ・マガジン・価格・有料ライン)は入れていません。変えたいときは公開設定の画面で自分で入れてください。\n${skipped.join("\n")}\n`
        : "") +
      `\n${results.join("\n")}`,
    failed || moved ? "warn" : "ok",
    [],
    account ?? (await readAccount(S)),
  );
}

/**
 * アカウントを確かめられなかったとき(#102)、バナーの見える部分の先頭に出す 1 行。たたんだままでも気づけるように。
 * 無ければ空
 */
function accountWarning(results: string[]): string {
  const line = results.find((r) => r.startsWith(`${ACCOUNT_STEP} ⚠️ `));
  return line ? `${line.slice(ACCOUNT_STEP.length + 1)}\n` : "";
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
  const price = article.price;
  const anchor = article.paywallAnchor;
  if (price && anchor !== undefined && document.querySelector(S.publishSettings.paywallContainer)) {
    // 有料エリア設定の画面(ラインを引く画面)で「もう一度入れる」を押したとき: この画面にはハッシュタグの欄も「公開に進む」も無いので、
    // 公開設定の工程は通らず、有料エリアの工程だけを入れ直す
    results.push("公開設定 − 有料エリア設定の画面が開いているので、ハッシュタグ・マガジン・有料・価格は入れ直していません。前の画面で入れたものを確かめてください");
    await step("有料エリア", results, () => setPaywallLine(S, anchor));
  } else {
    // ハッシュタグとマガジンは別の工程にする。マガジンが見つからなくても、ハッシュタグが入ったことは分かるように
    const opened = await step("公開設定", results, () => fillPublishSettings(S, article));
    const magazine = article.magazine;
    if (opened && magazine) await step("マガジン", results, () => selectMagazine(S, magazine));
    // 有料・価格も別の工程にする(失敗しても、ハッシュタグとマガジンの結果は残す)
    if (opened && price) await step("有料・価格", results, () => setPaidPrice(S, price, anchor !== undefined));
    // 本文に「ここから有料」の印があれば、「有料エリア設定」を押して、その位置にラインを引く(別の工程。失敗してもほかの結果は残す)。
    // ラインを引いたら止まる。その画面の「投稿する」「キャンセル」は押さない
    if (opened && price && anchor !== undefined) await step("有料エリア", results, () => setPaywallLine(S, anchor));
  }
  // 失敗した工程は、たたんだままでも読めるように見出しに出す(「詳細」の中だけだと気づけない)。
  // 工程名は外し、失敗の文言(複数行のこともある)をそのまま ⚠️ 付きで並べる
  const failed = results.filter((r) => r.includes(" ✗ ")).map((r) => r.slice(r.indexOf(" ✗ ") + 3));
  // 公開設定を入れたあとにも、どのアカウントかを 1 回だけ読んで出す(#106)。「投稿する」を押す前に気づけるように
  const account = await readAccount(S);
  banner(
    accountWarning(results) +
      (failed.length
        ? `${failed.map((m) => `⚠️ ${m}`).join("\n")}\n\n入ったものは画面で確かめ、足りないものは手で入れてから、「投稿する」を自分で押してください。\n`
        : `✅ 入力が終わりました。内容を確認して、「投稿する」を自分で押してください。\n\n`) +
      `「キャンセル」で戻ると、ハッシュタグとマガジン${article.price ? "・有料の設定" : ""}は note 側で消えます。\n直したあとは「もう一度入れる」を押してください。\n${results.join("\n")}`,
    failed.length ? "warn" : "ok",
    [{ label: "もう一度入れる", onClick: () => runPublishSettings(S, article, before, keyRef) }],
    account,
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
