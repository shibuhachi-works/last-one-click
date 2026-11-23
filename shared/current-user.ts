// ログイン中の note アカウントを読む(#106)。
// アカウントを 2 つ持っている人が、違うアカウントで投稿してしまわないよう、名前とアイコンを画面に出すためだけに使う。
//
// 決まり:
// - 問い合わせるのは、ログイン中のユーザーの情報を返す 1 か所だけ(selectors/note.json の account.currentUserUrl)。GET だけ
// - 拡張は Cookie を読まない。ユーザーの note のタブ(content script)から fetch し、Cookie はブラウザが付ける
// - 読んだ名前・ID・アイコンの URL は、画面に出すだけ。保存しない(chrome.storage にも入れない)・外へ送らない
// - 読めなければ(ログインしていない・応答の形が違う・通信の失敗)null を返す。エラーにしない
import type { SelectorsJson } from "./selectors-schema";

export type AccountSelectors = SelectorsJson["account"];

/** 画面に出す、ログイン中のアカウント */
export type CurrentUser = {
  /** 表示名(読めなければ ID) */
  name: string;
  /** note の ID(note.com/<ID>)。読めなければ無い */
  id?: string;
  /** アイコンの画像の URL(https だけ)。読めなければ無い */
  iconUrl?: string;
};

/** 名前・ID の長さの上限(これより長ければ切る。画面を壊さないため) */
const MAX_LABEL_LEN = 60;
/** アイコンの URL の長さの上限(これより長ければ出さない) */
const MAX_ICON_URL_LEN = 2000;
/** 問い合わせを待つ時間。過ぎたら読めなかったことにする(下書きの作成を待たせないため) */
export const CURRENT_USER_TIMEOUT_MS = 5_000;

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

/** 問い合わせ先の URL。"/" で始まるときは、いま開いているページ(note.com か editor.note.com)の origin に付ける */
export function resolveCurrentUserUrl(url: string, pageOrigin: string): string {
  return new URL(url, pageOrigin).href;
}

/** "data.nickname" のような道筋で値を取る */
export function valueAt(data: unknown, path: string): unknown {
  let v: unknown = data;
  for (const key of path.split(".")) {
    if (!v || typeof v !== "object" || Array.isArray(v) || !Object.hasOwn(v, key)) return undefined;
    v = (v as Record<string, unknown>)[key];
  }
  return v;
}

function label(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.length > MAX_LABEL_LEN ? `${s.slice(0, MAX_LABEL_LEN)}…` : s;
}

function iconUrl(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > MAX_ICON_URL_LEN) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** 道筋の候補を順に見て、最初に読めた値と、その道筋を返す */
function firstAt<T>(data: unknown, paths: readonly string[], read: (v: unknown) => T | undefined): { value: T; path: string } | undefined {
  for (const path of paths) {
    const value = read(valueAt(data, path));
    if (value !== undefined) return { value, path };
  }
  return undefined;
}

/** 応答の JSON から、名前・ID・アイコンを読む。名前も ID も無ければ null */
export function readCurrentUser(data: unknown, S: AccountSelectors): CurrentUser | null {
  const name = firstAt(data, S.namePaths, label)?.value;
  const id = firstAt(data, S.idPaths, label)?.value;
  if (!name && !id) return null;
  const icon = firstAt(data, S.iconPaths, iconUrl)?.value;
  return { name: (name ?? id)!, ...(id ? { id } : {}), ...(icon ? { iconUrl: icon } : {}) };
}

/** 1 回だけ問い合わせる。GET・Cookie はブラウザに任せる(credentials: "include")・転送はたどらない */
async function request(S: AccountSelectors, pageOrigin: string, fetchFn: FetchLike, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(resolveCurrentUserUrl(S.currentUserUrl, pageOrigin), {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ログイン中のアカウントを読む。読めなければ null(投げない)。
 * 呼ぶのは、ポップアップを開いたとき・下書きを入れ終えたときなど、必要なときに 1 回だけ
 */
export async function fetchCurrentUser(
  S: AccountSelectors,
  pageOrigin: string,
  fetchFn: FetchLike = fetch,
  timeoutMs = CURRENT_USER_TIMEOUT_MS,
): Promise<CurrentUser | null> {
  try {
    const res = await request(S, pageOrigin, fetchFn, timeoutMs);
    if (!res.ok) return null;
    return readCurrentUser(await res.json(), S);
  } catch {
    return null;
  }
}

/** 診断の節。値は出さず、応答の有無・HTTP の状態・読めた道筋と文字数だけを出す */
export type CurrentUserDiagnosis = { lines: string[]; secrets: Set<string> };

export async function diagnoseCurrentUser(
  S: AccountSelectors,
  pageOrigin: string,
  fetchFn: FetchLike = fetch,
  timeoutMs = CURRENT_USER_TIMEOUT_MS,
): Promise<CurrentUserDiagnosis> {
  const secrets = new Set<string>();
  const lines = [`### ログイン中のユーザーの問い合わせ`];
  let url: URL;
  try {
    url = new URL(resolveCurrentUserUrl(S.currentUserUrl, pageOrigin));
  } catch {
    return { lines: [...lines, `- 問い合わせ先の URL が読めません`], secrets };
  }
  lines.push(`- 問い合わせ先: ${url.host}${url.pathname}`);

  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await request(S, pageOrigin, fetchFn, timeoutMs);
  } catch (e) {
    lines.push(`- 応答: ありません(${(e as Error)?.name || "通信の失敗"})`);
    return { lines, secrets };
  }
  lines.push(`- 応答: あり、HTTP ${res.status}`);
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    lines.push(`- 本文: JSON として読めません`);
    return { lines, secrets };
  }

  const strings = new Set<string>();
  const collect = (v: unknown, depth: number) => {
    if (depth > 6) return;
    if (typeof v === "string") strings.add(v);
    else if (Array.isArray(v)) v.forEach((x) => collect(x, depth + 1));
    else if (v && typeof v === "object") Object.values(v).forEach((x) => collect(x, depth + 1));
  };
  collect(data, 0);

  const show = (name: string, paths: readonly string[]) => {
    for (const path of paths) {
      const v = valueAt(data, path);
      if (v === undefined) continue;
      if (typeof v === "string" || typeof v === "number") secrets.add(String(v));
      lines.push(`- ${name}: ${path} (${kind(v)})`);
      return;
    }
    lines.push(`- ${name}: 見つかりません(${paths.join(" / ")})`);
  };
  show("名前", S.namePaths);
  show("ID", S.idPaths);
  show("アイコン", S.iconPaths);

  // 道筋が合わないときに直せるよう、上から 2 段までのキーの名前と形を出す(値と同じ文字のキーは伏せる)
  const keys: string[] = [];
  const seg = (k: string) => (strings.has(k) || !/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(k) ? "***" : k);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data)) {
      keys.push(`${seg(k)} (${kind(v)})`);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v)) keys.push(`${seg(k)}.${seg(k2)} (${kind(v2)})`);
      }
    }
  }
  lines.push(`- キー: ${keys.length ? `${Math.min(keys.length, 60)} 個${keys.length > 60 ? `(全 ${keys.length} 個)` : ""}` : "ありません"}`);
  for (const k of keys.slice(0, 60)) lines.push(`  - ${k}`);
  return { lines, secrets };
}

function kind(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "配列";
  if (typeof v === "string") return `文字 ${v.length} 字`;
  if (typeof v === "object") return "オブジェクト";
  return typeof v;
}
