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

// 中身は空白で始まらず、空白で終わらない。中身にインラインコードの印(`)があれば受け持たない(コードの中の ** を印と取り違えないため)
const STRONG = /^\*\*(?![\s*])([^`]+?)(?<![\s*])\*\*(?!\*)/;
const EM = /^\*(?![\s*])([^`*]+?)(?<![\s*])\*(?!\*)/;

type Lexer = { inlineTokens: (src: string) => unknown[] };
type Token = { type: string; raw: string; text: string; tokens: unknown[] };

function emphasis(name: string, type: "strong" | "em", re: RegExp) {
  return {
    name,
    level: "inline" as const,
    start(src: string): number | undefined {
      const i = src.indexOf("*");
      return i < 0 ? undefined : i;
    },
    tokenizer(this: { lexer: Lexer }, src: string): Token | undefined {
      const m = re.exec(src);
      if (!m || !touchesCjkPunct(m[1])) return undefined;
      return { type, raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
    },
  };
}

/** marked.use({ extensions }) に渡す。太字(**)を先に試す */
export const CJK_EMPHASIS_EXTENSIONS = [emphasis("cjkStrong", "strong", STRONG), emphasis("cjkEm", "em", EM)];
