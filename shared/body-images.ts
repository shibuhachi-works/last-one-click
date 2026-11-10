// 本文の画像(#51)。md の `![説明](image1.png)` のように、URL ではなくファイル名(相対パス)で書いた画像を、
// note の本文のその位置に入れる。
//
// 流れ:
// 1. md を HTML にするとき、相対パスの画像を「目印」の文字(［画像1: image1.png］)にする
// 2. 画像のファイルを集める(GitHub から読んだときは記事と同じフォルダから取る。手元の md なら一緒にドロップした画像)
// 3. note の本文に貼ったあと、目印の文字を選んで、画像のファイルを貼り付ける(2026-11-10 実機で、貼り付けで入ることを確かめた)
// 入れられなかった画像は目印が本文に残るので、どこに何を入れればよいかが分かる。
//
// URL(https://…)で書いた画像は、これまでどおり <img> のまま貼る(ここでは扱わない)。
import { parseFrontMatter } from "./article.js";
import { decodeEntities } from "./markdown-safe.js";

/** 1 記事に入れる本文の画像の上限(埋め込みと同じ) */
export const MAX_BODY_IMAGES = 20;

/**
 * 下書きの中身(本文・見出し画像・本文の画像)を chrome.storage.local に入れて content script に渡すときの上限。
 * storage.local は 10MB まで(unlimitedStorage の権限は持たない)なので、ほかの保存データの分を残して 9MB にする。
 * 画像は base64 で入れるので、元の大きさの 4/3 で数える
 */
export const MAX_PENDING_BYTES = 9 * 1024 * 1024;

/** base64 にしたときの長さ(バイト) */
export function base64Size(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/** URL ではなく、記事からの相対パスで書いた画像か(https:・data: などのスキーム、// 始まり、# 始まりは違う) */
export function isLocalImageSrc(src: string): boolean {
  const s = src.trim();
  if (!s || s.startsWith("#") || s.startsWith("//") || s.startsWith("/")) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(s);
}

/** 相対パスの最後のファイル名(./images/a%20b.png → a b.png) */
export function imageFileName(src: string): string {
  const path = src.trim().split(/[?#]/)[0];
  const last = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * 本文に置く目印の文字。n は 1 から(同じファイルを 2 回使っても目印は別になる)。
 * tag は変換のたびに作る印で、記事の中にもともと同じ文字があっても取り違えないようにする(makeMarkerTag)
 */
export function imageMarker(n: number, src: string, tag: string): string {
  return `［画像${n}・${tag}: ${imageFileName(src)}］`;
}

/** 目印の印。記事の md に含まれない文字列になるまで作り直す */
export function makeMarkerTag(markdown: string, random: () => number = Math.random): string {
  for (;;) {
    const tag = Math.floor(random() * 36 ** 4).toString(36).padStart(4, "0");
    if (!markdown.includes(tag)) return tag;
  }
}

/** caption は md の ![説明](image1.png "キャプション") の "…"(title)。note の画像のキャプションに入れる(alt は入れない) */
export type BodyImageRef = { marker: string; src: string; alt: string; caption?: string };

/**
 * md を HTML にするときの image の差し替え。相対パスの画像は目印の文字にして refs に足し、
 * それ以外は fallback(SAFE_RENDERER.image)に任せる
 */
export function makeImageRenderer(refs: BodyImageRef[], fallback: (token: { href: string; title?: string | null; text: string }) => string, tag: string) {
  return (token: { href: string; title?: string | null; text: string }): string => {
    // marked は href の文字参照(&amp; など)を残すので、ファイル名として使う前に戻す(SAFE_RENDERER.image と同じ)
    const href = decodeEntities(token.href);
    if (!isLocalImageSrc(href)) return fallback(token);
    const marker = imageMarker(refs.length + 1, href, tag);
    const caption = token.title ? decodeEntities(token.title).trim() : "";
    refs.push({ marker, src: href.trim(), alt: token.text, ...(caption ? { caption } : {}) });
    // 目印は文字として貼る。HTML の特殊文字はファイル名に入っていても文字のまま出す
    return marker.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
}

/** ドロップされた画像の中から、src(相対パス)に当たるものを探す。ファイル名で比べる(大文字・小文字は区別しない) */
export function findDroppedImage<T extends { name: string }>(files: T[], src: string): T | undefined {
  const want = imageFileName(src).toLowerCase();
  return files.find((f) => f.name.toLowerCase() === want);
}

type MarkedLike = new (options: Record<string, unknown>) => { parse: (src: string, options?: Record<string, unknown>) => unknown };

/**
 * md の本文に、ファイル名(相対パス)で書いた画像のファイル名(小文字)。ドロップされた画像を、本文の画像と見出し画像に振り分けるため。
 * 本文を変換するときと同じ marked で読むので、<a b.png> の形や参照形式(![図][fig])でも同じ結果になる。
 * front matter も本文の変換と同じ parseFrontMatter で外す(空の front matter でも、本文の --- を巻き込まない)。
 * marked はここでは import しない(使う側の Marked を渡す)
 */
export function localImageNames(MarkedClass: MarkedLike, markdown: string, fallback: (token: { href: string; title?: string | null; text: string }) => string): Set<string> {
  return new Set(localImageSrcs(MarkedClass, markdown, fallback).map((s) => imageFileName(s).toLowerCase()));
}

/** md の本文に、ファイル名(相対パス)で書いた画像の参照先(書いたとおりの相対パス。文字参照は戻したもの)。記事のフォルダ・ZIP の中から相対パスで探すため */
export function localImageSrcs(MarkedClass: MarkedLike, markdown: string, fallback: (token: { href: string; title?: string | null; text: string }) => string): string[] {
  const refs: BodyImageRef[] = [];
  // 中身(YAML)は使わないので読まない
  const body = parseFrontMatter(markdown, () => null).content;
  new MarkedClass({ gfm: true, breaks: true, renderer: { image: makeImageRenderer(refs, fallback, "0000") } }).parse(body);
  return [...new Set(refs.map((r) => r.src))];
}
