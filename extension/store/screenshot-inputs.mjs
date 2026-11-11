// ストアの画像(screenshots.mjs で作るもの)の元になるファイルと、その指紋(SHA-256)。
// 画像を作ったときの指紋を screenshots.lock に残し、check-screenshots.mjs が今の指紋と比べる。
// 画素で比べないのは、環境ごとのフォントの描き方の違いで、誤って「古い」と出ないようにするため。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);

/** 画像の見た目を決めるファイル(extension/ からの相対パス)。画像に写る部品を足したら、ここにも足す */
export const SCREENSHOT_INPUTS = [
  "src/popup.html",
  "src/popup.css",
  "store/marquee.svg",
  "store/promo-small.svg",
  "store/screenshots.mjs",
];

export const LOCK_FILE = path.join(dir, "screenshots.lock");

/** 元のファイルの指紋。改行コード(CRLF/LF)の違いは同じとみなす */
export function inputsHash() {
  const h = createHash("sha256");
  for (const rel of SCREENSHOT_INPUTS) {
    const text = readFileSync(path.join(dir, "..", rel), "utf8").replace(/\r\n/g, "\n");
    h.update(`${rel}\0${text}\0`);
  }
  return h.digest("hex");
}
