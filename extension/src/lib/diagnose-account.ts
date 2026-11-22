// 診断の節「ログイン中のアカウントの手がかり」。
// note の画面のどこから「ログイン中のアカウント」が分かるかを調べるための節。
// 診断の結果は公開の Issue に貼ってもらうので、名前・ID・アイコンの URL などの中身は出さない。
// 「どこに・何があるか」(道筋・件数・文字数・形)だけを出す。読むだけで、押さない・開かない・問い合わせない。

const MAX_ITEMS = 20;
const MAX_DATA_PATHS = 40;
const MAX_DEPTH = 12;
const MAX_NODES = 20_000;

/** アイコンらしい画像を見分ける言葉(alt・class・親の aria-label などに含まれるか) */
const AVATAR_WORDS = /avatar|icon|user|アカウント|プロフィール/i;
/** メニューを開くボタンを見分ける言葉 */
const MENU_WORDS = ["アカウント", "メニュー", "マイページ"];
/** 埋め込まれたデータの中で探すキー(大文字・小文字は区別しない) */
const ACCOUNT_KEYS = new Set(
  ["user", "currentUser", "current_user", "me", "urlname", "nickname", "profileImage", "profileImagePath", "profile_image_path", "userId", "user_id"].map((k) =>
    k.toLowerCase(),
  ),
);
/** 埋め込まれたデータの道筋で、そのまま出してよい構造の名前(これ以外のキーは *** にする) */
const STRUCTURE_KEYS = new Set([
  "props", "pageProps", "initialProps", "initialState", "state", "store", "data", "auth", "session", "account", "profile",
  "viewer", "login", "loginUser", "currentUserData", "page", "query", "config", "fetch", "layout", "error", "serverRendered",
  "pinia", "vuex", "modules", "entities", "users", "author", "owner", "creator", "result", "results", "payload", "response",
]);
/** note.com/<1 語> のうち、アカウントのページではないもの */
const NOT_PROFILE = new Set([
  "notes", "hashtag", "search", "settings", "sitesettings", "login", "signup", "premium", "info", "topic", "topics",
  "interests", "contests", "magazines", "membership", "dashboard", "terms", "privacy", "about", "help",
]);

/** 伏せなくてよい、ありふれた言葉(alt="icon" などを伏せると、ほかの節の class まで消えるため) */
const GENERIC = /^(user|icon|avatar|image|img|アイコン|ユーザー|ユーザーアイコン|プロフィール|プロフィール画像|アカウント)$/i;

export type AccountHints = {
  lines: string[];
  /** レポート全体から伏せる文字列(名前・ID・アイコンの URL など)。ほかの節に紛れても出さないため */
  secrets: Set<string>;
};

export function accountHints(pathOf: (el: Element) => string, visible: (el: HTMLElement) => boolean): AccountHints {
  const lines: string[] = [];
  const secrets = new Set<string>();
  const addSecret = (s: string | null | undefined) => {
    const v = (s ?? "").trim();
    if (v.length < 2 || GENERIC.test(v)) return;
    if (/^\d+$/.test(v) && v.length < 5) return; // 短い数字は位置や大きさと見分けがつかない
    secrets.add(v);
  };

  lines.push(`## ログイン中のアカウントの手がかり`);
  lines.push(`(名前・ID・アイコンの URL などの中身は出しません。道筋・件数・文字数・形だけです)`);

  // 1. アイコンらしい画像
  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("img")).filter((img) => {
    const hay = [
      img.getAttribute("alt"),
      img.getAttribute("class"),
      img.getAttribute("aria-label"),
      img.parentElement?.getAttribute("aria-label"),
      img.parentElement?.getAttribute("class"),
      img.closest("a, button")?.getAttribute("aria-label"),
    ].join(" ");
    return AVATAR_WORDS.test(hay);
  });
  lines.push(`### アイコンらしい画像 (${imgs.length} 件)`);
  for (const img of imgs.slice(0, MAX_ITEMS)) {
    const alt = img.getAttribute("alt") ?? "";
    addSecret(alt);
    const src = img.getAttribute("src") ?? "";
    addSecret(src);
    if (img.currentSrc) addSecret(img.currentSrc);
    const r = img.getBoundingClientRect();
    lines.push(
      `- ${Math.round(r.width)}x${Math.round(r.height)} alt ${alt.length} 字 src: ${hostOf(src)} ${visible(img) ? "(visible)" : "(hidden)"} path: ${pathOf(img)}`,
    );
  }

  // 2. プロフィールらしいリンク(https://note.com/<1 語>)
  const profiles: { a: HTMLAnchorElement; id: string }[] = [];
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const id = profileId(a.getAttribute("href") ?? "");
    if (id) profiles.push({ a, id });
  }
  for (const { id } of profiles) addSecret(id);
  lines.push(`### プロフィールらしいリンク (${profiles.length} 件、ID の種類 ${new Set(profiles.map((p) => p.id)).size} 個)`);
  for (const { a, id } of profiles.slice(0, MAX_ITEMS)) {
    const hasImg = a.querySelector("img") ? " 画像あり" : "";
    lines.push(`- href: note.com/***(${id.length} 文字)${hasImg} ${visible(a) ? "(visible)" : "(hidden)"} path: ${pathOf(a)}`);
  }

  // 3. ページに埋め込まれたデータ(キーの道筋だけ。値は出さない)
  lines.push(`### ページに埋め込まれたデータ`);
  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>("script#__NEXT_DATA__, script[type='application/json'], script[type='application/ld+json']"),
  );
  if (!scripts.length) lines.push(`- JSON の script: ありません`);
  for (const s of scripts) {
    const where = `script${s.id ? `#${s.id}` : ""}[type="${s.type}"]`;
    let data: unknown;
    try {
      data = JSON.parse(s.textContent ?? "");
    } catch {
      lines.push(`- ${where}: JSON として読めません`);
      continue;
    }
    lines.push(...dataLines(where, data, addSecret));
  }
  // 拡張の content script からは window.__NUXT__ が見えない(別の世界で動く)ので、見えるときだけ読む
  const nuxt = (globalThis as { __NUXT__?: unknown }).__NUXT__;
  if (nuxt && typeof nuxt === "object") lines.push(...dataLines("window.__NUXT__", nuxt, addSecret));
  else lines.push(`- window.__NUXT__: ${nuxt === undefined ? "見えません" : "オブジェクトではありません"}`);
  // __NUXT__ を作る script(関数の形で書かれていて JSON ではない)は、キーの名前が書かれているかだけを見る
  const nuxtScripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script:not([src])")).filter((s) =>
    /__NUXT__\s*=/.test(s.textContent ?? ""),
  );
  lines.push(`- __NUXT__ を作る script: ${nuxtScripts.length} 個`);
  for (const s of nuxtScripts.slice(0, 3)) {
    const text = s.textContent ?? "";
    const found: string[] = [];
    for (const key of ACCOUNT_KEYS) {
      const re = new RegExp(`["']?\\b${key}\\b["']?\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')?`, "gi");
      let m: RegExpExecArray | null;
      let n = 0;
      while ((m = re.exec(text))) {
        n++;
        if (m[1]) addSecret(m[1].slice(1, -1));
      }
      if (n) found.push(`${key}:${n}`);
    }
    lines.push(`  - 長さ ${text.length} 字、キー: ${found.length ? found.join(", ") : "見つかりません"}`);
  }

  // 4. メニューを開くボタン
  const menus = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], a")).filter((el) => {
    const hay = [el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("aria-haspopup") ? "メニュー" : ""].join(" ");
    return MENU_WORDS.some((w) => hay.includes(w));
  });
  lines.push(`### メニューを開くボタン (${menus.length} 件)`);
  for (const el of menus.slice(0, MAX_ITEMS)) {
    const label = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`;
    const words = MENU_WORDS.filter((w) => label.includes(w));
    const popup = el.getAttribute("aria-haspopup") ? ` aria-haspopup="${el.getAttribute("aria-haspopup")}"` : "";
    lines.push(
      `- ${el.tagName.toLowerCase()} 言葉: ${words.join("・") || "(aria-haspopup)"}${popup} ${visible(el) ? "(visible)" : "(hidden)"} path: ${pathOf(el)}`,
    );
  }
  lines.push(``);
  return { lines, secrets };
}

/** https://note.com/<1 語>(相対の /<1 語> も)なら、その 1 語を返す */
export function profileId(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href, "https://note.com/");
  } catch {
    return null;
  }
  if (u.hostname !== "note.com") return null;
  const m = /^\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname);
  if (!m || NOT_PROFILE.has(m[1]!.toLowerCase())) return null;
  return m[1]!;
}

function hostOf(src: string): string {
  if (!src) return "(なし)";
  if (src.startsWith("data:")) return "data:";
  try {
    return new URL(src, location.href).hostname || "(なし)";
  } catch {
    return "(読めません)";
  }
}

/** データの中で、アカウントのキーがある道筋を出す。値は出さない(伏せる文字列に入れる) */
function dataLines(where: string, data: unknown, addSecret: (s: string) => void): string[] {
  // 道筋の途中のキーが ID や名前のことがある(ID をキーにした表など)。データの中の文字の値と同じキーは伏せる
  const values = new Set<string>();
  let nodes = 0;
  const collect = (v: unknown, depth: number) => {
    if (nodes++ > MAX_NODES || depth > MAX_DEPTH) return;
    if (typeof v === "string") values.add(v);
    else if (Array.isArray(v)) for (const x of v) collect(x, depth + 1);
    else if (v && typeof v === "object") for (const x of Object.values(v)) collect(x, depth + 1);
  };
  collect(data, 0);

  // 同じ道筋の繰り返し(同じ形の記事一覧など)で上限を使い切らないよう、重複を除いてから「異なる道筋の数」に上限をかける
  const paths = new Set<string>();
  nodes = 0;
  // 決まった構造の名前(下の一覧)と探すキーだけをそのまま出し、ほかのキーは *** にする(ID をキーにした表で、ID が値に無くても出さないため)
  const seg = (k: string) => (!values.has(k) && (ACCOUNT_KEYS.has(k.toLowerCase()) || STRUCTURE_KEYS.has(k)) ? k : "***");
  const walk = (v: unknown, path: string, depth: number) => {
    if (nodes++ > MAX_NODES || depth > MAX_DEPTH) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, `${path}[]`, depth + 1);
      return;
    }
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      const p = `${path}.${seg(k)}`;
      if (ACCOUNT_KEYS.has(k.toLowerCase())) {
        if (paths.size < MAX_DATA_PATHS) paths.add(`${p} (${kindOf(x)})`);
        if (typeof x === "string" || typeof x === "number") addSecret(String(x));
      }
      walk(x, p, depth + 1);
    }
  };
  walk(data, "", 0);
  const unique = Array.from(paths);
  const out = [`- ${where}: キー ${unique.length} 個${unique.length ? "(*** は伏せたキー)" : "(見つかりません)"}`];
  for (const p of unique) out.push(`  - ${p}`);
  return out;
}

function kindOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "配列";
  if (typeof v === "string") return `文字 ${v.length} 字`;
  if (typeof v === "object") return "オブジェクト";
  return typeof v;
}

/** レポート全体から、伏せる文字列を *** に置き換える(長いものから) */
export function redact(report: string, secrets: Set<string>): string {
  let out = report;
  for (const s of Array.from(secrets).sort((a, b) => b.length - a.length)) out = out.split(s).join("***");
  return out;
}
