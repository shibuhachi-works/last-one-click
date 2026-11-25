// 追加の対応先(library.libecity.com)を使えるようにする仕組み。
// 入れるときの権限の警告を増やさないため、このホストは optional_host_permissions に置き、
// そのサイトのページ(エディタ以外でも)を開いてツールバーのアイコンを押した人にだけ、ポップアップで許可を求める。
// 下書きの入力は、今開いているそのページのタブにだけ入れて止まる(#120。extension/src/lib/extra-site-fill.ts)。
//
// chrome の API は ExtraSiteApi として外から渡す(テストでは偽物を渡す。ルートの tsconfig には chrome の型が無い)

/** extension/build.mjs が esbuild の define で置き換える。開発用のビルド(EXTRA_SITE=1 npm run build)のときだけ true */
declare const __EXTRA_SITE__: boolean | undefined;

/**
 * 追加の対応先を拡張で使うか。実機で下書きの入力を確かめるまでは、ストアの版には入口(案内・スイッチ・登録・診断・下書きの入力)を出さない。
 * ふつうのビルド(npm run build・npm run package)とテストでは false。
 * 開発用のビルド(extension/ で EXTRA_SITE=1 npm run build)でだけ true になり、dist/manifest.json に
 * activeTab・scripting と optional_host_permissions を足す(extension/extra-site-manifest.mjs。#118)。
 * ストアの版でも使えるようにするときは、extension/manifest.json に 3 つを足し、
 * shared/manifest-permissions.test.ts と extension/store/listing.md の権限の理由も同じ PR で戻す(v0.1.7 で外した。#120)
 */
export const EXTRA_SITE_ENABLED: boolean = typeof __EXTRA_SITE__ !== "undefined" && __EXTRA_SITE__ === true;

export const EXTRA_SITE_HOST = "library.libecity.com";
/** optional_host_permissions と、content script の matches に使う */
export const EXTRA_SITE_ORIGIN = `https://${EXTRA_SITE_HOST}/*`;
/** chrome.scripting.registerContentScripts の id */
export const EXTRA_SITE_SCRIPT_ID = "extra-site";
/** extension/build.mjs が書き出す content script のファイル */
export const EXTRA_SITE_SCRIPT_FILE = "extra-site.js";

/** エディタの入力欄を見つけるためのセレクタ。どれか 1 つが当たればよい */
export type EditorProbe = { title: string[]; body: string[] };

/**
 * 案内(「使えるようにする」)と診断に使う、広めのセレクタ。
 * 先頭は #119 の診断で分かった値。下書きを入れるかの確かめは、狭い EXTRA_SITE_FILL_PROBE を使う
 */
export const EXTRA_SITE_EDITOR_PROBE: EditorProbe = {
  title: ["#title", 'input[placeholder*="タイトル"]', 'textarea[placeholder*="タイトル"]', 'input[name="title"]'],
  body: ['[data-lexical-editor][contenteditable="true"]', '[contenteditable="true"]', ".ProseMirror", ".ql-editor"],
};

/**
 * 下書きを入れるときに使うセレクタ(#119 の診断から。selectors/extra-site.json で上書きできる)。
 * どれも、先頭から順に見て、最初に当たったものを使う
 */
export type ExtraSiteSelectors = {
  /** タイトルの欄 */
  title: string[];
  /** 本文のエディタ(書き込める欄) */
  body: string[];
  /** 本文に画像を入れる、隠れたファイルの欄 */
  bodyImageInput: string[];
  /** 記事の設定(見出し画像・タグの欄がある所) */
  settingsMenu: string[];
  /** 記事の設定がたたまれているときに開くボタン(押してよいのはこれだけ) */
  settingsMenuOpenButton: string[];
  /** 見出し画像のファイルの欄 */
  eyecatchInput: string[];
  /** タグの欄 */
  tagInput: string[];
  /** タグの欄の近くの、公認タグの候補の並び(入ったかを数えるときに除く) */
  tagSuggest: string[];
  /** 公認タグの候補のボタン(押すとそのタグが足される。選ばれていると is_selected が付く) */
  tagSuggestItem: string[];
  /** 足したタグ(「#タグ」と × の印のボタン)。入ったかを数えるのに使う */
  tagItem: string[];
  /** 要約の欄 */
  summary: string[];
  /** 外部公開の範囲の「冒頭のみ公開」の radio */
  publishScopeLimited: string[];
  /** 外部公開の範囲の「全文公開」の radio */
  publishScopePublic: string[];
  /** カテゴリを選ぶ画面を開くボタン(「カテゴリを選択」。選んだあとは「大 > 小」の文字になる) */
  categoryOpen: string[];
  /** 選んだカテゴリが入る、隠れた欄 */
  categoryValue: string[];
  /** カテゴリを選ぶ画面 */
  categoryDialog: string[];
  /** 選ぶ画面の、大きなカテゴリのまとまり。中に名前と、小さなカテゴリのボタンがある */
  categoryMain: string[];
  /** 大きなカテゴリの名前 */
  categoryMainName: string[];
  /** 大きなカテゴリを開くところ(たたまれているときだけ押す) */
  categoryMainToggle: string[];
  /** 小さなカテゴリのボタン(押すと選ばれる) */
  categorySub: string[];
  /** 小さなカテゴリの名前 */
  categorySubName: string[];
  /** 選ぶ画面を閉じるボタン(選び終えても開いたままのときだけ押す) */
  categoryClose: string[];
  /** 読了目安時間を出すかの checkbox */
  readingTime: string[];
  /** ログイン中のアカウントのアイコンの画像(ヘッダーの右上。編集画面にもある) */
  accountIcon: string[];
  /** ログイン中のアカウントの名前(マイページの左の欄。編集画面には無い) */
  accountName: string[];
};

/** selectors/extra-site.json が無い・読めないときの値。ファイルがあっても、欠けた項目はこの値を使う */
export const EXTRA_SITE_DEFAULT_SELECTORS: ExtraSiteSelectors = {
  title: ["#title", 'input[name="title"]'],
  body: ['[data-lexical-editor][contenteditable="true"]', '.ContentEditable__root[contenteditable="true"]'],
  bodyImageInput: ["#fileInputForEditor"],
  settingsMenu: ["#article_setting_menu"],
  settingsMenuOpenButton: [".article_setting_menu_index"],
  eyecatchInput: ["#fileInput", ".js_dragDropFileInput"],
  tagInput: ['input[placeholder*="タグ"]'],
  tagSuggest: [".article_tag_suggest"],
  tagSuggestItem: [".article_tag_suggest_item"],
  tagItem: [".article_tag_inputArea .tagItems"],
  summary: ["#summary", 'textarea[name="summary"]'],
  publishScopeLimited: ["#publishScope_limited"],
  publishScopePublic: ["#publishScope_public"],
  categoryOpen: [".article_category .btn_selectCategory", ".btn_selectCategory"],
  categoryValue: ['.article_category input[name="category"]', 'input[name="category"]'],
  categoryDialog: ["#selectCategory"],
  categoryMain: [".category_lists .main_cat_item"],
  categoryMainName: [".cat_name"],
  categoryMainToggle: [".main_cat_inner"],
  categorySub: [".sub_cat_inner"],
  categorySubName: [".sub_cat_name"],
  categoryClose: ["#selectCategory .modal-header button.close", "#selectCategory .btn-close"],
  readingTime: ["#setting_estimatedReadingTime"],
  accountIcon: [".btn_mypage img.rounded-circle", ".mypageSide .profile_img img.rounded-circle"],
  accountName: [".mypageSide .profile_name"],
};

/**
 * selectors/extra-site.json の中身を、既定値と合わせる。項目ごとに、空でない文字の配列のときだけ使う
 * (無い・形が違う項目は既定値のまま。知らない項目は無視する)
 */
export function resolveExtraSiteSelectors(json: unknown): ExtraSiteSelectors {
  const out = Object.fromEntries(
    Object.entries(EXTRA_SITE_DEFAULT_SELECTORS).map(([k, v]) => [k, [...v]]),
  ) as ExtraSiteSelectors;
  if (!json || typeof json !== "object" || Array.isArray(json)) return out;
  for (const key of Object.keys(EXTRA_SITE_DEFAULT_SELECTORS) as (keyof ExtraSiteSelectors)[]) {
    const v = (json as Record<string, unknown>)[key];
    if (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim() !== "")) out[key] = [...v];
  }
  return out;
}

/** extension/build.mjs が esbuild の define で、selectors/extra-site.json の中身(無ければ null)に置き換える */
declare const __EXTRA_SITE_SELECTORS__: unknown;

/** 拡張に同梱した selectors/extra-site.json と既定値を合わせたもの(テストでは既定値) */
export function extraSiteSelectors(): ExtraSiteSelectors {
  return resolveExtraSiteSelectors(typeof __EXTRA_SITE_SELECTORS__ !== "undefined" ? __EXTRA_SITE_SELECTORS__ : null);
}

/**
 * 追加の対応先のログイン中のアカウント。ページに出ている名前・アイコンを読むだけ(問い合わせはしない)。
 * 名前が読めないときは iconUrl だけ。画面に出すだけで、保存しない
 */
export type ExtraSiteAccount = { name?: string; iconUrl?: string };

/**
 * 名前の出ている、追加の対応先のページ(マイページの「通知設定」。記事の一覧が無く軽い)。
 * 開いているページに名前が無いとき(編集画面など)だけ、content script がこのページを 1 回だけ GET で読む
 */
export const EXTRA_SITE_ACCOUNT_PAGE_URL = `https://${EXTRA_SITE_HOST}/notification_settings`;

/** アカウントを聞くタブを選ぶ。今のタブが追加の対応先なら、それ。無ければ、いちばん最近見た追加の対応先のタブ */
export function pickExtraSiteTab<T extends { id?: number; url?: string; active?: boolean; lastAccessed?: number }>(
  current: T | undefined,
  tabs: T[],
): number | undefined {
  if (current?.id !== undefined && isExtraSiteUrl(current.url)) return current.id;
  const found = tabs
    .filter((t) => t.id !== undefined && isExtraSiteUrl(t.url))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  return found?.id;
}

/** 今のタブに下書きを入れられるか(タイトルと本文の欄がどちらもあるか)の確かめに使う */
export function fillProbe(selectors: ExtraSiteSelectors = extraSiteSelectors()): EditorProbe {
  return { title: selectors.title, body: selectors.body };
}

/** ポップアップのボタンの文字。今のタブが追加の対応先の編集画面のとき、「note の下書きを作成」の代わりに出す */
export const EXTRA_SITE_SUBMIT_LABEL = "今開いているページに下書きを入れる";

/**
 * ポップアップのボタンの文字。今のタブが編集画面でなく、記事の target が note 以外で、許可があるとき。
 * note と同じく、新しいタブで新規記事のエディタを開いて入れる
 */
export const EXTRA_SITE_NEW_SUBMIT_LABEL = `${EXTRA_SITE_HOST} の新規記事を開いて下書きを入れる`;

/** 新規記事を作るページ。開くと、番号付きの編集画面(/articles/<番号>/edit)に移る */
export const EXTRA_SITE_NEW_ARTICLE_URL = `https://${EXTRA_SITE_HOST}/articles/new`;

/** URL が新規記事のページ(移る前)か */
export function isExtraSiteNewArticleUrl(url: string | undefined): boolean {
  return isExtraSiteUrl(url) && /^\/articles\/new\/?$/.test(new URL(url!).pathname);
}

/** URL が記事の編集画面(/articles/<番号>/edit)か */
export function isExtraSiteEditUrl(url: string | undefined): boolean {
  return isExtraSiteUrl(url) && /^\/articles\/[^/]+\/edit\/?$/.test(new URL(url!).pathname);
}

/** 新しく開いたタブの様子を聞くもの(service worker が chrome.tabs と probe でつなぐ。テストでは差し替える) */
export type NewEditorDeps = {
  /** タブの今の URL と、読み込み中か */
  tab(tabId: number): Promise<{ url?: string; loading: boolean } | null>;
  /** 編集画面の欄(タイトルと本文)が出ているか */
  probe(tabId: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /**
   * 編集画面でないページ(ログインの画面など)で読み込みが終わったとき、ページ(URL)ごとに 1 回呼ぶ。
   * そのページに「ログインすると、そのまま入れます」と知らせるのに使う
   */
  onWaitingPage?(url: string): void;
};

/**
 * 新規記事のエディタが開くのを待つ長さ。ログインしていないと、ログインの画面を経てから編集画面に移るので、
 * ログインし終えるまで待てるよう長めにする
 */
export const NEW_EDITOR_WAIT_MS = 10 * 60_000;

/**
 * 新しく開いたタブが、新規記事の編集画面になって欄が出るまで待つ。
 * 途中のページ(ログインの画面や、ログインのための移動)では止まらずに待ち続ける(ログインし終えると編集画面に移るため)。
 * タブが閉じられたときと、待ちきれなかったときはエラー
 */
export async function waitForNewEditor(tabId: number, deps: NewEditorDeps, timeoutMs = NEW_EDITOR_WAIT_MS): Promise<void> {
  const end = deps.now() + timeoutMs;
  let notified: string | undefined;
  for (;;) {
    const t = await deps.tab(tabId);
    if (!t) throw new Error("新規記事のタブが閉じられました。もう一度ポップアップから入れてください。");
    if (isExtraSiteEditUrl(t.url)) {
      let ok = false;
      try {
        ok = await deps.probe(tabId);
      } catch {
        ok = false; // 読み込みの途中など。少し待って確かめ直す
      }
      if (ok) return;
    } else if (!t.loading && t.url && !isExtraSiteNewArticleUrl(t.url) && t.url !== "about:blank" && t.url !== notified) {
      notified = t.url;
      deps.onWaitingPage?.(t.url);
    }
    if (deps.now() >= end) {
      throw new Error(
        `${EXTRA_SITE_HOST} の新規記事のエディタが ${Math.round(timeoutMs / 60_000) || 1} 分待っても開きませんでした。ログインしてから、もう一度ポップアップから入れてください。`,
      );
    }
    await deps.sleep(500);
  }
}

/** 本文の画像として入れられる種類(ファイルの欄の accept が無いとき。#119 の診断では png・jpg・jpeg) */
export const EXTRA_SITE_IMAGE_ACCEPT = ".png,.jpg,.jpeg,image/png,image/jpeg";

/**
 * ファイルの欄の accept(".png,.jpg" や "image/png"、"image/*" の形)が、そのファイルを受け付けるか。
 * accept が空なら EXTRA_SITE_IMAGE_ACCEPT で見る
 */
export function acceptsFile(accept: string | null | undefined, file: { name: string; mimeType: string }): boolean {
  const list = (accept?.trim() ? accept : EXTRA_SITE_IMAGE_ACCEPT)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const name = file.name.toLowerCase();
  const mime = file.mimeType.toLowerCase();
  return list.some((a) => {
    if (a.startsWith(".")) return name.endsWith(a);
    if (a.endsWith("/*")) return mime.startsWith(a.slice(0, -1));
    return mime === a;
  });
}

/** このページへ入れる記事(ポップアップが組み立てる。ArticlePayload のうち、使うものだけ) */
export type ExtraSiteArticle = {
  title: string;
  hashtags: string[];
  /** 貼り付ける本文の HTML(本文の画像は目印の文字になっている) */
  html: string;
  thumbnail?: { name: string; mimeType: string; base64: string };
  images?: { marker: string; name: string; mimeType: string; base64: string; caption?: string }[];
  /** 本文の画像で、ポップアップの時点で入れられないと分かったもの(上限・見つからない・大きすぎる) */
  imageNotes?: string[];
  /** 要約の欄に入れる文(front matter の summary) */
  summary?: string;
  /** カテゴリ(front matter の category)。「大きなカテゴリ > 小さなカテゴリ」か、小さなカテゴリだけ */
  category?: string;
  /** 外部公開の範囲(front matter の「外部公開」)。public は全文公開、limited は冒頭のみ公開 */
  publishScope?: "public" | "limited";
  /** 読了目安時間を出すか(front matter の「読了目安時間」) */
  readingTime?: boolean;
};

/**
 * このページでは入らない(または入るか分からない)書き方の知らせ。入れる前にポップアップに出し、ページのバナーにも出す。
 * 箇条書き・番号付きリスト・コードは、エディタにボタンが無いので、貼り付けでどう入るかは実機で確かめる(#120)
 */
export function extraSiteUnsupportedNotes(input: {
  html: string;
  insertToc?: boolean;
  embedUrls?: boolean;
  magazine?: string;
  price?: number;
  images?: { name: string; mimeType: string; caption?: string }[];
}): string[] {
  const notes: string[] = [];
  const has = (re: RegExp) => re.test(input.html);
  if (has(/<(?:ul|ol)[\s>]/i)) notes.push(`箇条書き・番号付きリスト(${EXTRA_SITE_HOST} のエディタにはボタンが無いので、そのまま入らないことがあります)`);
  if (has(/<pre[\s>]/i) || has(/<code[\s>]/i)) notes.push(`コード(${EXTRA_SITE_HOST} のエディタにはボタンが無いので、ふつうの文字で入ることがあります)`);
  if (has(/<table[\s>]/i)) notes.push("表(そのまま入らないことがあります)");
  if (input.insertToc) notes.push(`目次(${EXTRA_SITE_HOST} では入れません)`);
  if (input.embedUrls) notes.push(`URL だけの行の埋め込み(${EXTRA_SITE_HOST} では入れません。URL の文字のまま入ります)`);
  if (input.magazine?.trim()) notes.push(`マガジン(${EXTRA_SITE_HOST} では入れません)`);
  if (input.price !== undefined) notes.push(`有料の価格(${EXTRA_SITE_HOST} では入れません)`);
  const skipped = (input.images ?? []).filter((i) => !acceptsFile(null, i)).map((i) => i.name);
  if (skipped.length) notes.push(`png・jpg 以外の本文の画像(${skipped.join(", ")}。入れずに目印を残します)`);
  const captioned = (input.images ?? []).filter((i) => i.caption?.trim() && acceptsFile(null, i)).map((i) => i.name);
  if (captioned.length) notes.push(`本文の画像のキャプション(${captioned.join(", ")}。画像だけを入れます)`);
  return notes;
}

/** URL が追加の対応先のページか(https で、ホストが完全に一致するときだけ) */
export function isExtraSiteUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === EXTRA_SITE_HOST;
  } catch {
    return false;
  }
}

/**
 * そのページにエディタの入力欄(タイトルと本文)があるか。
 * chrome.scripting.executeScript でページの中に渡して動かすので、外の変数や関数を使わない(この関数だけで閉じる)。
 * 読むだけ: ボタンを押さない、入力しない、外へ送らない
 */
export function probeEditor(probe: EditorProbe): boolean {
  const found = (selectors: string[]) =>
    selectors.some((selector) => {
      try {
        return document.querySelector(selector) !== null;
      } catch {
        return false; // 書き方の誤ったセレクタは、当たらなかったことにする
      }
    });
  return found(probe.title) && found(probe.body);
}

/** chrome の API のうち、ここで使うもの(extension/src/lib/extra-site.ts が chrome.* でつなぐ) */
export type ExtraSiteApi = {
  /** chrome.permissions.contains */
  hasPermission(): Promise<boolean>;
  /** chrome.permissions.request。ボタンを押したクリックの中で呼ぶ */
  requestPermission(): Promise<boolean>;
  /** chrome.permissions.remove */
  removePermission(): Promise<boolean>;
  /** chrome.scripting.getRegisteredContentScripts で、登録があるか */
  isRegistered(): Promise<boolean>;
  /** chrome.scripting.registerContentScripts */
  register(): Promise<void>;
  /** chrome.scripting.unregisterContentScripts */
  unregister(): Promise<void>;
  /** chrome.scripting.executeScript で probeEditor を 1 回動かす。probe を省くと EXTRA_SITE_EDITOR_PROBE */
  probe(tabId: number, probe?: EditorProbe): Promise<boolean>;
};

/** ポップアップの案内をどう出すか。"editor" は今のタブがエディタ、"site" はそれ以外の追加の対応先のページ。null は出さない */
export type ExtraSiteOffer = "editor" | "site" | null;

/**
 * ポップアップに案内を出すか。今のタブが追加の対応先のページで、まだ許可が無いとき。
 * エディタを開いていなくても(記事の一覧などでも)出す。エディタかどうかは、案内の文を変えるためだけに見る。
 * ホストが違うとき(note のページを含む)は、ページの中では何も動かさない
 */
export async function shouldOfferExtraSite(api: ExtraSiteApi, tab: { id?: number; url?: string } | undefined): Promise<ExtraSiteOffer> {
  if (tab?.id === undefined || !isExtraSiteUrl(tab.url)) return null;
  if (await api.hasPermission()) return null;
  try {
    return (await api.probe(tab.id)) ? "editor" : "site";
  } catch {
    return "site"; // ページに入れなかった(読み込み中・エラーのページなど)ときも、ドメインが合えば出す
  }
}

/**
 * 今のタブに下書きを入れるか(ポップアップのボタンを「今開いているページに下書きを入れる」にするか)。
 * 今のタブが追加の対応先のページで、許可があり、タイトルと本文の欄があるときだけ。
 * そのときは、新しいタブを開かずに、このタブに入れる
 */
export async function shouldFillExtraSite(api: ExtraSiteApi, tab: { id?: number; url?: string } | undefined): Promise<boolean> {
  if (tab?.id === undefined || !isExtraSiteUrl(tab.url)) return false;
  if (!(await api.hasPermission())) return false;
  try {
    return await api.probe(tab.id, fillProbe());
  } catch {
    return false;
  }
}

/** 登録が「同じ id がある」で失敗したあと、登録が見えてくるのを待つ長さ */
const REGISTER_RECHECK_MS = 300;

async function registeredAfter(api: ExtraSiteApi, ms: number): Promise<boolean> {
  await new Promise((r) => setTimeout(r, ms));
  return api.isRegistered();
}

/** 許可のあるなしに、content script の登録を合わせる。戻り値は許可があるか */
export async function syncExtraSite(api: ExtraSiteApi): Promise<boolean> {
  const granted = await api.hasPermission();
  const registered = await api.isRegistered();
  if (granted && !registered) {
    try {
      await api.register();
    } catch (e) {
      // service worker とポップアップが同時に登録すると、あとのほうは「同じ id がある」で失敗する。登録があれば良い
      // 別のところの登録が終わる途中だと、まだ見えないことがある。少し待ってから確かめ直す
      if (!(await api.isRegistered()) && !(await registeredAfter(api, REGISTER_RECHECK_MS))) {
        // それでも見えないのに「同じ id がある」で失敗することがある(許可を外して付け直したとき、同時に消している途中など)。
        // 一度消してから、もう一度だけ登録する
        try {
          await api.unregister();
        } catch {
          // 無ければ消せない。そのまま登録し直す
        }
        try {
          await api.register();
        } catch (e2) {
          if (!(await api.isRegistered())) throw e2;
        }
      }
    }
  } else if (!granted && registered) {
    try {
      await api.unregister();
    } catch (e) {
      if (await api.isRegistered()) throw e;
    }
  }
  return granted;
}

/**
 * 「使えるようにする」を押したとき。許可を求める呼び出しを最初に(クリックの中で)行う。
 * 許可されたら登録を作り、されなかったら何も変えない。戻り値は許可されたか
 */
export async function enableExtraSite(api: ExtraSiteApi): Promise<boolean> {
  const granted = await api.requestPermission();
  if (!granted) return false;
  return syncExtraSite(api);
}

/** 「追加の対応先」のスイッチを切ったとき。許可を外し、登録を消す。戻り値は、まだ許可が残っているか */
export async function disableExtraSite(api: ExtraSiteApi): Promise<boolean> {
  await api.removePermission();
  return syncExtraSite(api);
}
