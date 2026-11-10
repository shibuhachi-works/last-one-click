// 日本語の文で、太字・斜体の印(** と *)のすぐ内側に全角のかぎかっこや句読点があると、
// CommonMark の決まり(left-flanking / right-flanking)では強調にならず、印が本文に残る。
// 例: 説明はたいてい、**「マグネシウムが肌から入って効く」**というものです。
// 英語は語の間に空白があるので起きにくいが、日本語は語の間に空白が無いので起きやすく、AI はこの形をよく書く。
//
// ここでは、印のすぐ内側の最初か最後が全角の句読点のときだけ、強調として読む marked の拡張を作る。
// それ以外(英語の強調など)は何もせず、marked の決まりのままにする。
// marked 自体はここでは import しない(各パッケージの marked を使う)。
// 使い方: marked.use({ extensions: CJK_EMPHASIS_EXTENSIONS })

/** 全角の句読点・かっこ・記号(「」『』、。・(): など) */
const CJK_PUNCT = /[　-〿・！-／：-＠［-｀｛-･]/;

/** 強調の中身の最初か最後が全角の句読点なら true(このときだけ受け持つ) */
export function touchesCjkPunct(inner: string): boolean {
  return CJK_PUNCT.test(inner[0] ?? "") || CJK_PUNCT.test(inner[inner.length - 1] ?? "");
}

/** 閉じる印を探すときに読み飛ばす範囲: リンク・画像 [..](..)、自動リンク <scheme:...>、メールの <a@b> */
const SKIP = /^(?:!?\[[^\[\]]*\]\([^()]*\)|<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>|<[^\s<>@]+@[^\s<>]+>)/;

/**
 * src の先頭の印(marker: "**" か "*")から始まる強調を探し、中身を返す。見つからなければ null。
 * - 中身は空白で始まらず、空白で終わらない。印の前後に * が続く形(*** など)は受け持たない
 * - 中身にインラインコードの印(`)があれば受け持たない(コードの中の ** を印と取り違えないため)
 * - \* のようにエスケープされた印は、閉じる印にしない
 * - リンク・自動リンクの中(URL の中の ** など)は、閉じる印を探さずに読み飛ばす
 */
export function findEmphasis(src: string, marker: "**" | "*"): string | null {
  const n = marker.length;
  if (!src.startsWith(marker) || src[n] === "*" || /\s/.test(src[n] ?? " ")) return null;
  for (let i = n; i < src.length; ) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") return null;
    if (c === "[" || c === "!" || c === "<") {
      const m = SKIP.exec(src.slice(i));
      if (m) {
        i += m[0].length;
        continue;
      }
    }
    if (c === "*") {
      if (src.startsWith(marker, i)) {
        const inner = src.slice(n, i);
        if (!/\s/.test(inner[inner.length - 1]) && !inner.endsWith("*") && src[i + n] !== "*") return inner;
      }
      // 斜体の中に、閉じる印にならない * があれば受け持たない
      if (marker === "*") return null;
    }
    i++;
  }
  return null;
}

type Lexer = { inlineTokens: (src: string) => unknown[] };
type Token = { type: string; raw: string; text: string; tokens: unknown[] };

function emphasis(name: string, type: "strong" | "em", marker: "**" | "*") {
  return {
    name,
    level: "inline" as const,
    start(src: string): number | undefined {
      const i = src.indexOf("*");
      return i < 0 ? undefined : i;
    },
    tokenizer(this: { lexer: Lexer }, src: string): Token | undefined {
      const inner = findEmphasis(src, marker);
      if (inner === null || !touchesCjkPunct(inner)) return undefined;
      return { type, raw: `${marker}${inner}${marker}`, text: inner, tokens: this.lexer.inlineTokens(inner) };
    },
  };
}

/** marked.use({ extensions }) に渡す。太字(**)を先に試す */
export const CJK_EMPHASIS_EXTENSIONS = [emphasis("cjkStrong", "strong", "**"), emphasis("cjkEm", "em", "*")];
