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

/** 1 記事に入れる本文の画像の上限(埋め込みと同じ) */
export const MAX_BODY_IMAGES = 20;

/** 画像のファイルの合計の上限(base64 にする前のバイト数)。chrome.storage.local に入れて content script に渡すため */
export const MAX_BODY_IMAGE_BYTES = 7 * 1024 * 1024;

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

/** 本文に置く目印の文字。n は 1 から(同じファイルを 2 回使っても目印は別になる) */
export function imageMarker(n: number, src: string): string {
  return `［画像${n}: ${imageFileName(src)}］`;
}

export type BodyImageRef = { marker: string; src: string; alt: string };

/**
 * md を HTML にするときの image の差し替え。相対パスの画像は目印の文字にして refs に足し、
 * それ以外は fallback(SAFE_RENDERER.image)に任せる
 */
export function makeImageRenderer(refs: BodyImageRef[], fallback: (token: { href: string; title?: string | null; text: string }) => string) {
  return (token: { href: string; title?: string | null; text: string }): string => {
    if (!isLocalImageSrc(token.href)) return fallback(token);
    const marker = imageMarker(refs.length + 1, token.href);
    refs.push({ marker, src: token.href.trim(), alt: token.text });
    // 目印は文字として貼る。HTML の特殊文字はファイル名に入っていても文字のまま出す
    return marker.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
}

/** ドロップされた画像の中から、src(相対パス)に当たるものを探す。ファイル名で比べる(大文字・小文字は区別しない) */
export function findDroppedImage<T extends { name: string }>(files: T[], src: string): T | undefined {
  const want = imageFileName(src).toLowerCase();
  return files.find((f) => f.name.toLowerCase() === want);
}

/** md の中で、相対パスで書いた画像のファイル名(ドロップされた画像を、本文の画像と見出し画像に振り分けるため) */
export function localImageNamesInMarkdown(md: string): Set<string> {
  const names = new Set<string>();
  // コードの中まで厳密には除かない。ここは振り分けの目安で、実際に入れる画像は変換のときに決まる
  for (const m of md.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) {
    if (isLocalImageSrc(m[1])) names.add(imageFileName(m[1]).toLowerCase());
  }
  return names;
}
