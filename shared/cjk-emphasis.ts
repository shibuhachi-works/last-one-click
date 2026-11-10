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

/** かっこ([] () <>)の開きと閉じの数が合っているか。合っていなければ、印がリンクなどの途中にある */
function bracketsBalanced(text: string): boolean {
  const pairs: [string, string][] = [["[", "]"], ["(", ")"], ["<", ">"]];
  return pairs.every(([o, c]) => text.split(o).length === text.split(c).length);
}

/**
 * src の先頭の印(marker: "**" か "*")から始まる強調を探し、中身を返す。見つからなければ null。
 * - 中身は空白で始まらず、空白で終わらない。印の前後に * が続く形(*** など)は受け持たない
 * - 中身にインラインコードの印(`)があれば受け持たない(コードの中の ** を印と取り違えないため)
 * - 閉じる印の候補のうち、中身のかっこの数が合わないもの(リンク先の URL の中の ** など)は飛ばして次を試す
 */
export function findEmphasis(src: string, marker: "**" | "*"): string | null {
  const n = marker.length;
  if (!src.startsWith(marker) || src[n] === "*" || /\s/.test(src[n] ?? " ")) return null;
  for (let i = src.indexOf(marker, n + 1); i >= 0; i = src.indexOf(marker, i + 1)) {
    const inner = src.slice(n, i);
    if (inner.includes("`")) return null;
    if (/\s/.test(inner[inner.length - 1]) || inner.endsWith("*") || src[i + n] === "*") continue;
    if (marker === "*" && inner.includes("*")) return null;
    if (bracketsBalanced(inner)) return inner;
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
