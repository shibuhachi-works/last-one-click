// 記事の読み込みのうち、ブラウザにも Node にも依存しない部分。拡張と Playwright 版で共通。
//   - GitHub の URL → 記事 md の raw URL と、同ディレクトリの raw ベース URL
//   - front matter(先頭の --- ブロック)の読み取り
//   - タイトルの決定・本文の "# タイトル" の除去・ハッシュタグの正規化・有料記事の価格(price)の読み取り
// Markdown → HTML と YAML の変換関数は呼び出し側が渡す(marked / yaml は各パッケージのものを使う。
// shared/ は 2 つのパッケージが別々に install するので、ここから node_modules を import しない)。
// 取得(fetch / トークン)とサムネイルの持ち方(Buffer / base64)は各パッケージに残す。
import { PAYWALL_MARKER, makePaywallToken, replacePaywallMarker, takePaywallAnchor } from "./paywall.js";

export type FrontMatter = {
  title?: string;
  hashtags?: string[];
  magazine?: string;
  thumbnail?: string;
  /** 有料記事の価格(円)。正の整数だけ。書かなければ無料のまま(公開設定の記事タイプに触らない) */
  price?: number;
  /**
   * price が正しくないときの直し方(parsePrice のエラーの文)。parseFrontMatter はここで止めず、ほかの項目は読む。
   * ポップアップで欄を直せば送れるようにするため。欄を使わない組み立て(renderArticle の final でない呼び出し)ではエラーにする
   */
  priceError?: string;
  /** price が正しくないときの、書かれていた値(ポップアップの欄にそのまま出して直してもらう) */
  priceRaw?: string;
};

/** YAML の文字列 → 値。各パッケージの `yaml` の parse を渡す */
export type YamlParse = (src: string) => unknown;

/**
 * GitHub のディレクトリ URL / ファイル URL / raw URL を、
 * 「記事 md の raw URL」と「同ディレクトリの raw ベース URL」に正規化する。
 *
 * 受け付ける形:
 *   https://github.com/owner/repo/tree/main/posts/2026-10-28-xxx
 *   https://github.com/owner/repo/blob/main/posts/2026-10-28-xxx/article.md
 *   https://raw.githubusercontent.com/owner/repo/main/posts/2026-10-28-xxx/article.md
 */
export function resolveArticleUrl(input: string): { mdUrl: string; baseUrl: string } {
  const u = new URL(input);
  let path: string;

  if (u.hostname === "raw.githubusercontent.com") {
    path = u.pathname; // /owner/repo/branch/path...
  } else if (u.hostname === "github.com") {
    // /owner/repo/(tree|blob)/branch/path...
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:tree|blob)\/(.+)$/);
    if (!m) throw new Error(`GitHub の tree/blob URL として解釈できません: ${input}`);
    path = `/${m[1]}/${m[2]}/${m[3]}`;
  } else {
    throw new Error(`対応していない URL です: ${input}`);
  }

  const raw = `https://raw.githubusercontent.com${path.replace(/\/$/, "")}`;
  if (raw.endsWith(".md")) {
    return { mdUrl: raw, baseUrl: raw.slice(0, raw.lastIndexOf("/")) };
  }
  return { mdUrl: `${raw}/article.md`, baseUrl: raw };
}

/**
 * front matter(先頭の "---" で囲まれたブロック)を YAML として読む。
 * 使うキーは title / hashtags / magazine / thumbnail / price だけで、他は無視する。
 * - 値は文字列に揃える(数値などもそのまま文字列に)。null や空は「無し」
 * - hashtags は配列でも "a, b" / "#a #b" の文字列でもよい。`#` は外す
 * - `hashtags: #AI #個人開発`(引用符なし)は YAML ではコメントになるが、README で許している書き方なので
 *   先に引用符で囲んでから読む
 * - price は正の整数(`300` / `"300"`)だけ。ほかの値は止めずに priceError / priceRaw に残す(ほかの項目は読む)
 * front matter が無ければ data は空で、content は入力のまま。YAML として読めなければエラー。
 */
export function parseFrontMatter(md: string, parseYaml: YamlParse): { data: FrontMatter; content: string } {
  // 空の front matter("---" の直後に "---")も直後の区切り行で閉じる(?? で「ブロックなし」を先に試す)
  const m = md.match(/^---\r?\n(?:([\s\S]*?)\r?\n)??---\r?\n?/);
  if (!m) return { data: {}, content: md };

  const block = (m[1] ?? "").replace(/^(hashtags:\s*)(#\S.*)$/m, (_, k: string, v: string) => `${k}${JSON.stringify(v)}`);
  let raw: unknown;
  try {
    raw = parseYaml(block);
  } catch (e) {
    throw new Error(`front matter が YAML として読めません: ${(e as Error).message.split("\n")[0]}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { data: {}, content: md.slice(m[0].length) };

  const obj = raw as Record<string, unknown>;
  const data: FrontMatter = {};
  for (const key of ["title", "magazine", "thumbnail"] as const) {
    const v = scalarToString(obj[key]);
    if (v !== undefined) data[key] = v;
  }
  const h = obj.hashtags;
  if (Array.isArray(h)) {
    data.hashtags = h.map(scalarToString).filter((s): s is string => s !== undefined).map((s) => s.replace(/^#/, "")).filter(Boolean);
  } else {
    const s = scalarToString(h);
    if (s !== undefined) data.hashtags = splitList(s);
  }
  try {
    const price = parsePrice(obj.price);
    if (price !== undefined) data.price = price;
  } catch (e) {
    data.priceError = (e as Error).message;
    data.priceRaw = scalarToString(obj.price) ?? JSON.stringify(obj.price);
  }
  return { data, content: md.slice(m[0].length) };
}

/**
 * 有料記事の価格を読む。正の整数(`300`)と、数字だけの文字列(`"300"`・ポップアップの欄の値)を受け付ける。
 * null / undefined / 空文字は「無し」(無料のまま)。0・負・小数・数字以外はエラーにして、直し方を出す。
 * 上限・下限は拡張では決めない(note の画面のエラーに任せる)
 */
export function parsePrice(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string" && v.trim() === "") return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(
      `price は 1 以上の整数(円)で書いてください(例: price: 300)。いまの値: ${JSON.stringify(v)}\n無料の記事にするときは、price の行を消すか、先頭に「# 」を付けてください。`,
    );
  }
  return n;
}

/** 文字列・数値・真偽値は文字列に。null / undefined / 空文字 / オブジェクトは「無し」 */
function scalarToString(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return undefined;
}

/** "[a, b]" / "a, b" / "a b" / "#a #b" をすべて配列にする(ポップアップの欄にも使う) */
export function splitList(v: string): string[] {
  return v
    .trim()
    .replace(/^\[|\]$/g, "")
    .split(/[,\s、]+/)
    .map((t) => t.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim().replace(/^#/, ""))
    .filter(Boolean);
}

export type RenderedArticle = {
  title: string;
  hashtags: string[];
  magazine?: string;
  /** note に貼り付ける HTML */
  html: string;
  /** front matter の thumbnail(相対パスのまま。解決と取得は呼び出し側) */
  thumbnail?: string;
  /** 有料記事の価格(円)。無ければ無料のまま */
  price?: number;
  /**
   * 本文に「ここから有料」の印(`<!-- ここから有料 -->`)があったときの、印の直前のブロックの文字。
   * 有料エリア設定の画面で、この文字のブロックのすぐ下にラインを引く。印が無ければ無い
   */
  paywallAnchor?: string;
};

export type ArticleOverride = {
  title?: string;
  hashtags?: string;
  magazine?: string;
  /** 価格の欄の値(数字だけの文字列)。final なら空は「無料のまま」、そうでなければ空は front matter を使う */
  price?: string;
  /**
   * true なら、title / hashtags / magazine / price は「最終的に送る値」として扱う(拡張のポップアップ: md から読み取った値を
   * 欄に出し、ユーザーがそこで直す)。空にしたら front matter に戻らず「なし」。本文先頭の # 見出しは、
   * front matter に title が無く、欄のタイトルがその見出しのままなら落とす(見出しをタイトルに使った扱い)。
   * false / 省略なら従来どおり「空は front matter を使う」上書き(Playwright 版の引数)
   */
  final?: boolean;
};

/** 各パッケージから渡す変換関数 */
export type Converters = {
  /** Markdown 本文 → HTML(SAFE_RENDERER 適用済みの marked) */
  markdown: (body: string) => string | Promise<string>;
  /** YAML → 値(yaml の parse) */
  yaml: YamlParse;
};

/**
 * Markdown から、タイトル・ハッシュタグ・マガジン・価格・本文 HTML を決める。
 * - title: override → front matter → 本文の最初の "# 見出し" の順。どれも無ければエラー
 * - 本文側の "# タイトル" は note のタイトル欄と二重になるので、それをタイトルに使ったときは落とす
 * - 本文の「ここから有料」の印(shared/paywall.ts)は本文から取り除き、直前のブロックの文字を paywallAnchor に入れる。
 *   印が 2 つ以上・本文の最初にある・price が無いときはエラー
 */
export async function renderArticle(markdown: string, convert: Converters, override: ArticleOverride = {}): Promise<RenderedArticle> {
  const { data: fm, content } = parseFrontMatter(markdown, convert.yaml);

  const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const overrideTitle = override.title?.trim();
  const title = override.final ? overrideTitle : overrideTitle || fm.title || h1;
  if (!title) throw new Error("タイトルがありません。front matter の title か、本文の最初の「# 見出し」に書いてください。");

  // 本文の # 見出しをタイトルに使ったとき(final: 欄のタイトルがその見出しのままのとき)は、本文から落とす
  const usedH1 = Boolean(h1) && !fm.title && (override.final ? title === h1 : !overrideTitle);
  const body = usedH1 ? content.replace(/^#\s+.+\n?/m, "") : content;
  // 「ここから有料」の印の行は、目印の段落に置き換えてから HTML にし、HTML から目印を取り除く(印を本文に文字で残さない)
  const token = makePaywallToken(markdown);
  const marked = replacePaywallMarker(body, token);
  let html = await convert.markdown(marked.content);
  let paywallAnchor: string | undefined;
  if (marked.found) ({ html, anchor: paywallAnchor } = takePaywallAnchor(html, token));

  const hashtags = override.final
    ? splitList(override.hashtags ?? "")
    : override.hashtags?.trim()
      ? splitList(override.hashtags)
      : (fm.hashtags ?? []);
  const magazine = override.final ? override.magazine?.trim() || undefined : override.magazine?.trim() || fm.magazine;
  // final(ポップアップ)は欄の値だけを見る。front matter の price が正しくなくても、欄で直せば送れる
  let price: number | undefined;
  if (override.final) price = parsePrice(override.price);
  else if (override.price?.trim()) price = parsePrice(override.price);
  else if (fm.priceError) throw new Error(fm.priceError);
  else price = fm.price;
  if (paywallAnchor !== undefined && price === undefined) {
    throw new Error(
      `本文に「${PAYWALL_MARKER}」がありますが、price がありません。front matter に price: 300 のように価格を書くか(ポップアップでは「価格(有料)」の欄に入れる)、印の行を消してください。`,
    );
  }

  return {
    title,
    hashtags,
    magazine,
    html,
    thumbnail: fm.thumbnail,
    ...(price !== undefined ? { price } : {}),
    ...(paywallAnchor !== undefined ? { paywallAnchor } : {}),
  };
}
