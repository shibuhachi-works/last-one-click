// selectors/note.json の読み込み。
//   1. chrome.storage に設定された URL(なければ DEFAULT_SELECTORS_URL)から fetch
//   2. 失敗したら 1 時間以内のキャッシュ
//   3. それも無ければ拡張に同梱した selectors/note.json
// note の DOM が変わっても、GitHub 上の JSON を直せば拡張の再配布なしで復旧できる。
import { validateSelectorsJson } from "../../../shared/selectors-schema";
import { STORAGE, type Selectors } from "./types";

/** リポジトリの selectors/note.json。フォークした場合はここか、ポップアップの「設定」で差し替える */
export const DEFAULT_SELECTORS_URL = "https://raw.githubusercontent.com/shibuhachi-works/last-one-click/main/selectors/note.json";

const CACHE_TTL_MS = 60 * 60 * 1000;

export type LoadedSelectors = {
  selectors: Selectors;
  source: "remote" | "cache" | "bundled";
  /** GitHub から取った値が検査を通らなかったとき、その理由(同梱の値に戻している) */
  warning?: string;
};

/**
 * GitHub から取った JSON は、使う前に必ず validateSelectorsJson を通す。
 * newNoteUrl が note 以外なら通らないので、偽ページを開かされることはない。
 */
export async function loadSelectors(): Promise<LoadedSelectors> {
  const stored = await chrome.storage.local.get([STORAGE.selectorsUrl, STORAGE.selectorsCache, STORAGE.githubToken]);
  // @types/chrome 0.3 から、読んだ値は unknown 扱いになったので型を明示する
  const url: string = (stored[STORAGE.selectorsUrl] as string | undefined) || DEFAULT_SELECTORS_URL;
  const cache = stored[STORAGE.selectorsCache] as { url: string; fetchedAt: number; data: Selectors } | undefined;

  if (cache && cache.url === url && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    try {
      return { selectors: validateSelectorsJson(cache.data), source: "cache" };
    } catch {
      await chrome.storage.local.remove(STORAGE.selectorsCache);
    }
  }

  let warning: string | undefined;
  try {
    // private リポジトリの場合は、設定に入れた GitHub トークンで取りに行く(raw.githubusercontent.com にしか送らない)
    const headers: Record<string, string> = {};
    const token = stored[STORAGE.githubToken] as string | undefined;
    if (token && new URL(url).hostname === "raw.githubusercontent.com") headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { cache: "no-store", headers });
    if (!res.ok) throw new Error(String(res.status));
    const data = validateSelectorsJson(await res.json());
    await chrome.storage.local.set({ [STORAGE.selectorsCache]: { url, fetchedAt: Date.now(), data } });
    return { selectors: data, source: "remote" };
  } catch (e) {
    warning = (e as Error).message;
    if (cache && cache.url === url) {
      try {
        return { selectors: validateSelectorsJson(cache.data), source: "cache", warning };
      } catch {
        /* 古いキャッシュも不正なら同梱へ */
      }
    }
    // 同梱の値も検査する(ビルドに入れた JSON が壊れていればここで気づく)
    const bundled = validateSelectorsJson(await (await fetch(chrome.runtime.getURL("selectors.json"))).json());
    return { selectors: bundled, source: "bundled", warning };
  }
}
