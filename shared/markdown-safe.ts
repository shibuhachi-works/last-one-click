// Markdown → HTML を安全側に寄せるための部品。拡張(ブラウザ)と Playwright 版(Node)で共通。
//
// - 記事に書かれた生の HTML(<img onerror=...> など)は通さず、文字として見せる
// - リンク・画像の URL は http(s) / mailto だけ。javascript: や data: は落とす
// - text/plain 用のテキスト化は DOM(innerHTML)を使わずに行う
//
// marked 自体はここでは import しない(各パッケージの marked を使う)。
// 使い方: marked.use({ renderer: SAFE_RENDERER })

import { HTML_ENTITIES } from "./html-entities.js";

const SAFE_LINK_PROTOCOLS = ["http:", "https:", "mailto:"];
const SAFE_IMAGE_PROTOCOLS = ["http:", "https:"];

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * URL をブラウザと同じ手順で整えてから検査し、通るなら整えた URL を返す。通らなければ null。
 * ブラウザ(URL 標準)は先頭・末尾の制御文字と空白を落とし、途中のタブ・改行を取り除いてから
 * scheme を読む。そのため "java\tscript:" はブラウザでは javascript: になる(Codex の指摘)。
 * 相対 URL は許可(記事内の相対リンク)。絶対 URL は scheme を見る。
 */
export function sanitizeUrl(href: string, protocols: readonly string[]): string | null {
  const s = href
    .replace(/[\t\n\r]/g, "") // 途中のタブ・改行はブラウザが無視する
    .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, ""); // 先頭・末尾の制御文字と空白
  if (s === "") return null;
  if (/[\u0000-\u001f\u007f]/.test(s)) return null; // それ以外の制御文字が残っていたら拒否
  // "javascript:" "data:" などは、先頭に scheme があれば URL として解釈できる
  const m = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!m) return /^[\s\\]*\/\//.test(s) ? null : s; // scheme なし。"//evil" も弾く
  return protocols.includes(`${m[1].toLowerCase()}:`) ? s : null;
}

export function isSafeUrl(href: string, protocols: readonly string[]): boolean {
  return sanitizeUrl(href, protocols) !== null;
}

type HtmlToken = { text: string };
// link / image の `title` と image の `text`(alt)は、marked 14 ではエスケープ済み、marked 18 では生の文字で渡ってくる。
// どちらでも同じ結果になるよう、文字参照をいったん文字に戻してから一度だけエスケープする(attr)。
// そのまま出すと、marked 18 では title の " で属性が壊れる。二重にエスケープすると "&amp;amp;" になる(Codex の指摘)。
// `href` はエスケープされていない。
// `href` に書かれた文字参照("?a=1&amp;b=2" の &amp;)は、いったん文字に戻してから検査・エスケープする。
// 戻せない名前(HTML5 だけの &colon; など)は & のままエスケープされ、ブラウザでも文字のまま。
// "javascript&colon;" が javascript: に化けることはない(& は常に &amp; になる)。
type LinkToken = { href: string; title?: string | null; tokens: unknown[] };
type ImageToken = { href: string; title?: string | null; text: string };
type CodeToken = { text: string; lang?: string; escaped?: boolean };

/**
 * marked v13+ の token 形式の renderer。
 * `this.parser` を使うので、必ず marked.use({ renderer: SAFE_RENDERER }) の形で渡す。
 */
/** 属性値・地の文に出す文字。エスケープ済みでも生でも、一度だけエスケープした形にそろえる */
function attr(s: string): string {
  return escapeHtml(decodeEntities(s));
}

export const SAFE_RENDERER = {
  /** 生の HTML(ブロック・インライン)は文字として出す */
  html(token: HtmlToken): string {
    return escapeHtml(token.text);
  },
  link(this: { parser: { parseInline(tokens: unknown[]): string } }, token: LinkToken): string {
    const text = this.parser.parseInline(token.tokens);
    const href = sanitizeUrl(decodeEntities(token.href), SAFE_LINK_PROTOCOLS);
    if (href === null) return text;
    const title = token.title ? ` title="${attr(token.title)}"` : "";
    return `<a href="${escapeHtml(href)}"${title}>${text}</a>`;
  },
  /**
   * コードブロック(``` と字下げ)。marked の既定は中身の最後に改行を 1 つ足し(`…\n</code></pre>`)、
   * note はそれを空の行として表示する(2026-11-10 実機)ので、足さない。
   * それ以外(エスケープ・言語の class)は marked の既定と同じ
   */
  code(token: CodeToken): string {
    const lang = (token.lang ?? "").match(/^\S*/)?.[0] ?? "";
    const body = token.text.replace(/\n$/, "");
    const code = token.escaped ? body : escapeHtml(body);
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    return `<pre><code${cls}>${code}</code></pre>\n`;
  },
  image(token: ImageToken): string {
    const href = sanitizeUrl(decodeEntities(token.href), SAFE_IMAGE_PROTOCOLS);
    if (href === null) return attr(token.text);
    const title = token.title ? ` title="${attr(token.title)}"` : "";
    return `<img src="${escapeHtml(href)}" alt="${attr(token.text)}"${title}>`;
  },
};


/** 文字参照を文字に戻す。数値(&#...; &#x...;)と HTML 4.01 の名前付き(html-entities.ts)。戻せないものはそのまま */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return HTML_ENTITIES[code] ?? whole; // 名前は大文字小文字を区別する(&Agrave; と &agrave;)
  });
}

/**
 * HTML からタグを除いて、貼り付けの text/plain に使う文字にする。
 * innerHTML を使わないので、どんな HTML でも読み込み・実行は起きない。
 * <pre> の中(コードブロック)は空白・改行をそのまま残す。詰めるのは地の文の改行だけ(Codex の指摘)。
 */
export function htmlToText(html: string): string {
  // <pre>...</pre> とそれ以外に分ける(split の捕捉グループで、奇数番目が <pre>)
  const parts = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "").split(/(<pre\b[^>]*>[\s\S]*?<\/pre\s*>)/i);
  const text = parts.map((part, i) => (i % 2 === 1 ? preToText(part) : proseToText(part))).join("");
  return text.replace(/^\n+|\n+$/g, ""); // 前後の改行だけ落とす(コードの先頭の字下げは残す)
}

/**
 * コードブロック: タグを除いて文字参照を戻すだけ。改行の圧縮や trim はしない。
 * SAFE_RENDERER はコードの最後に改行を足さない(#59)ので、無ければ 1 つ足して、次のブロックとの間を空ける
 */
function preToText(pre: string): string {
  const text = decodeEntities(pre.replace(/<[^>]+>/g, ""));
  return text.endsWith("\n") ? text : text + "\n";
}

/** 地の文: ブロックの切れ目を改行にし、3 つ以上続く改行は 2 つに詰める */
function proseToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section|article)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\n{3,}/g, "\n\n");
}
