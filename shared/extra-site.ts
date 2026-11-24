// 追加の対応先(library.libecity.com)を使えるようにする仕組み。
// 入れるときの権限の警告を増やさないため、このホストは optional_host_permissions に置き、
// そのページのエディタを開いてツールバーのアイコンを押した人にだけ、ポップアップで許可を求める。
// 下書きの入力はまだ無い(content script は空の受け口)。
//
// chrome の API は ExtraSiteApi として外から渡す(テストでは偽物を渡す。ルートの tsconfig には chrome の型が無い)

/** extension/build.mjs が esbuild の define で置き換える。開発用のビルド(EXTRA_SITE=1 npm run build)のときだけ true */
declare const __EXTRA_SITE__: boolean | undefined;

/**
 * 追加の対応先を拡張で使うか。下書きの入力ができるまでは、ストアの版には入口(案内・スイッチ・登録・診断)を出さない。
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
 * 仮の値。実機の画面構造はまだ取っていない(別の Issue で取ってから直す)。
 * タイトルは「タイトル」と書かれた入力欄、本文は書き込める欄(contenteditable)を探す
 */
export const EXTRA_SITE_EDITOR_PROBE: EditorProbe = {
  title: ['input[placeholder*="タイトル"]', 'textarea[placeholder*="タイトル"]', 'input[name="title"]'],
  body: ['[contenteditable="true"]', ".ProseMirror", ".ql-editor"],
};

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
  /** chrome.scripting.executeScript で probeEditor を 1 回動かす */
  probe(tabId: number): Promise<boolean>;
};

/**
 * ポップアップに案内を出すか。今のタブが追加の対応先のページで、まだ許可が無く、エディタの入力欄があるときだけ。
 * ホストが違うとき(note のページを含む)は、ページの中では何も動かさない
 */
export async function shouldOfferExtraSite(api: ExtraSiteApi, tab: { id?: number; url?: string } | undefined): Promise<boolean> {
  if (tab?.id === undefined || !isExtraSiteUrl(tab.url)) return false;
  if (await api.hasPermission()) return false;
  try {
    return await api.probe(tab.id);
  } catch {
    return false; // ページに入れなかった(読み込み中・エラーのページなど)ときは出さない
  }
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
      if (!(await api.isRegistered())) throw e;
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
