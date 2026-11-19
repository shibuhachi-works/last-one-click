// 有料記事の「ここから有料」の印(md の本文の `<!-- ここから有料 -->` の行)。
//
// 読み取り(Node とブラウザの両方。DOM 不要):
//   - 本文の中で、前後の空白を除いて印だけの行を、有料の境目として読む。Markdown のコード(``` / ~~~・字下げ・箇条書きの中のコードなど)の中の印は文字のまま。
//     コードの中かどうかは、本文の変換そのもので確かめる(markerLinesInCode)
//   - 印の行は本文から取り除いてから HTML にする(生の HTML は文字として出すので、残すと印が本文に出る)
//   - 印より前の最後のブロックの文字を、ラインを引く場所の目印(anchor)にする
//
// 画面での探し方(findPaywallTarget。ブラウザの中で動く。DOM 依存。この関数の中では import したものを使わない):
//   2026-11-16 の診断レポート: 「有料エリア設定」を押した先の本文は div.ProseMirror.paywall-setting(編集できない)で、
//   その直下にブロックとブロックの間ごとに div.ProseMirror-widget があり、中に「ラインをこの場所に変更」のボタンがある。
//   いまのラインは button#paywall-line(「このラインより先を有料にする」)で、選んだブロックのすぐ下に入れ替わって出る。
//   何番目のボタンかでは決めない(画像・箇条書き・目次で、note 側のブロックの数え方がずれるため)。
//   目印と同じ文字のブロックを探し、そのすぐ下の widget のボタンを返す。押すのは呼び出し側(safeClick を通す)。

import { decodeEntities } from "./markdown-safe.js";

/** 有料の境目の印。前後の空白を除いて、この文字だけの行 */
export const PAYWALL_MARKER = "<!-- ここから有料 -->";

/** 前後の空白を除いて印だけの行の番号(0 始まり)。コードの中かどうかは、ここでは見ない(markerLinesInCode で調べる) */
export function findMarkerLines(content: string): number[] {
  const hits: number[] = [];
  content.split("\n").forEach((line, i) => {
    if (line.trim() === PAYWALL_MARKER) hits.push(i);
  });
  return hits;
}

/**
 * 印の候補の行のうち、Markdown のコードの中(``` / ~~~ ・字下げのコード・箇条書きや引用の中のコード)にあるものの番号。
 * 自前で Markdown を読み分けず、本文の変換(convert)そのものに任せる: 候補の行の印を、行ごとに違う目印の文字に
 * その場で置き換えて(字下げはそのまま)一度変換し、目印が <code> の中に出た行をコードの中とみなす
 */
export async function markerLinesInCode(
  content: string,
  lines: readonly number[],
  token: string,
  convert: (md: string) => string | Promise<string>,
): Promise<Set<number>> {
  if (!lines.length) return new Set();
  const probe = content.split("\n");
  for (const i of lines) probe[i] = probe[i].replace(PAYWALL_MARKER, probeToken(token, i));
  const html = await convert(probe.join("\n"));
  const inCode = new Set<number>();
  for (const i of lines) {
    const at = html.indexOf(probeToken(token, i));
    // 見つからない(変換で消えた)ものも、印としては扱わない
    if (at < 0 || html.lastIndexOf("<code", at) > html.lastIndexOf("</code>", at)) inCode.add(i);
  }
  return inCode;
}

function probeToken(token: string, line: number): string {
  return `${token}N${line}N`;
}

/**
 * 本文の印の行(ignore の行を除く)を、目印の段落(token だけの段落)に置き換える。印が無ければ content はそのまま。
 * 印が 2 つ以上あればエラー。ignore には markerLinesInCode で調べた、コードの中の行を渡す
 */
export function replacePaywallMarker(content: string, token: string, ignore: ReadonlySet<number> = new Set()): { content: string; found: boolean } {
  const lines = content.split("\n");
  const hits = findMarkerLines(content).filter((i) => !ignore.has(i));
  if (hits.length > 1) {
    throw new Error(
      `本文に「${PAYWALL_MARKER}」の行が ${hits.length} つあります(本文の ${hits.map((i) => i + 1).join("・")} 行目)。有料の境目は 1 か所だけにしてください。`,
    );
  }
  if (hits.length === 0) return { content, found: false };
  // 前後を空行にして、目印だけの段落にする(箇条書きや段落の続きに混ざらないように)
  lines[hits[0]] = `\n${token}\n`;
  return { content: lines.join("\n"), found: true };
}

/** 本文の md に含まれない目印の文字を作る(英大文字だけ。marked の変換で形が変わらない) */
export function makePaywallToken(markdown: string): string {
  let token = "LASTONECLICKPAYWALLMARK";
  while (markdown.includes(token)) token += "X";
  return token;
}

/**
 * 変換した HTML から目印の段落を取り除き、その前の最後のブロック(いちばん外側の要素)の文字を返す。
 * 前にブロックが無ければ(印が本文の最初にあれば)エラー
 */
export function takePaywallAnchor(html: string, token: string): { html: string; anchor: string } {
  const re = new RegExp(`<p>${token}</p>\\n?`);
  const m = html.match(re);
  if (!m || m.index === undefined) throw new Error(`「${PAYWALL_MARKER}」の位置を本文の中で見つけられませんでした。印は、ほかの行と空行で分けて書いてください。`);
  const before = html.slice(0, m.index);
  const last = lastTopLevelBlock(before);
  if (last === undefined) {
    throw new Error(`「${PAYWALL_MARKER}」の前に本文がありません。印は、無料で読める部分のあとに書いてください。`);
  }
  return { html: before + html.slice(m.index + m[0].length), anchor: last };
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** HTML のいちばん外側の要素のうち、最後のものの文字(タグを除き、文字参照を戻したもの)。要素が無ければ undefined */
export function lastTopLevelBlock(html: string): string | undefined {
  let depth = 0;
  let start = -1;
  let last: [number, number] | undefined;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g)) {
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const end = m.index + m[0].length;
    if (!closing && (VOID_TAGS.has(name) || m[3] === "/")) {
      if (depth === 0) last = [m.index, end];
      continue;
    }
    if (!closing) {
      if (depth === 0) start = m.index;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) last = [start, end];
    }
  }
  if (!last) return undefined;
  // 文字参照は、名前付き(&copy; &mdash; など)も含めて表示の文字に戻す(画面の textContent と比べるため。markdown-safe と同じ戻し方)
  return decodeEntities(html.slice(last[0], last[1]).replace(/<[^>]+>/g, "")).trim();
}

export type PaywallTarget = {
  /**
   * ok: 押すボタンが見つかった / already: ラインはもう目印のブロックのすぐ下にある /
   * no-screen: 有料エリア設定の画面(本文)が無い / no-anchor: 目印の文字が空 /
   * not-found: 目印と同じ文字のブロックが無い / many: 2 つ以上ある / no-button: ブロックのすぐ下にボタンが無い
   */
  status: "ok" | "already" | "no-screen" | "no-anchor" | "not-found" | "many" | "no-button";
  /** 押す「ラインをこの場所に変更」(status が ok のときだけ) */
  button: HTMLElement | null;
  /** 目印と同じ文字のブロックの数 */
  count: number;
};

/**
 * 有料エリア設定の画面で、目印(anchor)と同じ文字のブロックのすぐ下にある「ラインをこの場所に変更」を探す。
 * 文字は NFKC にして空白を詰めて比べる。ボタンの文字が changeTexts と違うものは返さない
 */
export function findPaywallTarget(containerSel: string, widgetSel: string, changeTexts: readonly string[], lineSel: string, anchor: string): PaywallTarget {
  // 注: 内側に名前付き関数を作らない(tsx/esbuild の keepNames が __name を挿入し、ページ側に送ると未定義になる)
  const container = document.querySelector(containerSel);
  if (!container) return { status: "no-screen", button: null, count: 0 };
  const key = anchor.normalize("NFKC").replace(/[\s　]+/g, "");
  if (!key) return { status: "no-anchor", button: null, count: 0 };
  const texts = changeTexts.map((t) => t.normalize("NFKC").replace(/[\s　]+/g, "")).filter(Boolean);
  // ブロックとブロックの間の部品(widget・いまのライン)を除いたものが、本文のブロック
  const blocks = Array.from(container.children).filter((el) => !el.matches(widgetSel) && !el.matches(lineSel) && !el.querySelector(lineSel));
  const matches = blocks.filter((el) => (el.textContent ?? "").normalize("NFKC").replace(/[\s　]+/g, "") === key);
  if (matches.length === 0) return { status: "not-found", button: null, count: 0 };
  if (matches.length > 1) return { status: "many", button: null, count: matches.length };
  const next = matches[0].nextElementSibling;
  if (next && (next.matches(lineSel) || next.querySelector(lineSel))) return { status: "already", button: null, count: 1 };
  const button =
    next && next.matches(widgetSel)
      ? (Array.from(next.querySelectorAll<HTMLElement>("button")).find((b) =>
          texts.includes((b.textContent ?? "").normalize("NFKC").replace(/[\s　]+/g, "")),
        ) ?? null)
      : null;
  if (!button) return { status: "no-button", button: null, count: 1 };
  return { status: "ok", button, count: 1 };
}

/** findPaywallTarget の結果(ok / already 以外)を、直し方つきの文にする */
export function paywallFailureMessage(t: Pick<PaywallTarget, "status" | "count">): string {
  const manual = "画面で手でラインを引いてください。";
  switch (t.status) {
    case "no-screen":
      return `有料エリア設定の画面が出ませんでした。\n${manual}`;
    case "no-anchor":
      return `「${PAYWALL_MARKER}」の直前のブロックに文字が無い(画像や区切り線など)ので、ラインを引く場所を決められません。\n${manual}`;
    case "not-found":
      return `「${PAYWALL_MARKER}」の直前の段落と同じ文字のブロックが、有料エリア設定の画面に見つかりません。\n${manual}`;
    case "many":
      return `「${PAYWALL_MARKER}」の直前の段落と同じ文字のブロックが ${t.count} つあり、どこに引くか決められません。\n${manual}`;
    case "no-button":
      return `「${PAYWALL_MARKER}」の直前の段落のすぐ下に「ラインをこの場所に変更」が見つかりません。\n${manual}`;
    default:
      return manual;
  }
}
