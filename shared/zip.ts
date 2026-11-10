// ZIP の中身を取り出す(記事の md と画像をまとめた ZIP をドロップしたとき)。
// ライブラリは足さず、ブラウザ(と Node)に入っている DecompressionStream("deflate-raw") で解凍する。
// ディスクには書き出さない。取り出すのは md と画像の候補だけで、大きさと個数に上限を付ける
// (解凍すると極端に大きくなる ZIP で、ポップアップが固まらないように)。

/** ZIP の中で、1 ファイルあたりの解凍後の上限 */
export const MAX_ZIP_ENTRY_BYTES = 20 * 1024 * 1024;
/** ZIP の中身(取り出すファイル)の、解凍後の合計の上限 */
export const MAX_ZIP_TOTAL_BYTES = 60 * 1024 * 1024;
/** ZIP の中のファイル数の上限(フォルダや使わないファイルも数える) */
export const MAX_ZIP_ENTRIES = 1000;

export type ZipEntry = { path: string; data: Uint8Array };

/** 取り出すファイルか(md と画像だけ)。隠しファイル・__MACOSX は除く */
export function isBundleFile(path: string): boolean {
  const parts = path.split("/");
  if (parts.some((p) => p.startsWith(".") || p === "__MACOSX")) return false;
  return /\.(md|markdown|png|jpe?g|gif|webp)$/i.test(path);
}

/**
 * ZIP のバイト列から、md と画像のファイルを取り出す。
 * 対応: 無圧縮(0)と deflate(8)。暗号化・ZIP64・分割 ZIP は読めないので、エラーにする
 */
export async function readZip(buf: Uint8Array, keep: (path: string) => boolean = isBundleFile): Promise<ZipEntry[]> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error("ZIP ファイルとして読めません。");
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error("この ZIP(ZIP64)は読めません。フォルダのままドロップしてください。");
  if (count > MAX_ZIP_ENTRIES) throw new Error(`ZIP の中のファイルが多すぎます(${count} 個。${MAX_ZIP_ENTRIES} 個まで)。`);
  if (cdOffset + cdSize > buf.byteLength) throw new Error("ZIP ファイルが壊れています。");

  const out: ZipEntry[] = [];
  let total = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.byteLength || view.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP ファイルが壊れています。");
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const path = decodeName(buf.subarray(p + 46, p + 46 + nameLen), (flags & 0x0800) !== 0);
    p += 46 + nameLen + extraLen + commentLen;

    if (path.endsWith("/") || !keep(path)) continue;
    if (flags & 0x0001) throw new Error("パスワード付きの ZIP は読めません。");
    if (size > MAX_ZIP_ENTRY_BYTES) throw new Error(`ZIP の中の ${baseName(path)} が大きすぎます(${MAX_ZIP_ENTRY_BYTES / 1024 / 1024}MB まで)。`);
    total += size;
    if (total > MAX_ZIP_TOTAL_BYTES) throw new Error(`ZIP の中身が大きすぎます(md と画像の合計で ${MAX_ZIP_TOTAL_BYTES / 1024 / 1024}MB まで)。`);

    if (localOffset + 30 > buf.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("ZIP ファイルが壊れています。");
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (start + compSize > buf.byteLength) throw new Error("ZIP ファイルが壊れています。");
    const raw = buf.subarray(start, start + compSize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw, size);
    else throw new Error(`ZIP の中の ${baseName(path)} は読めない圧縮方式です。フォルダのままドロップしてください。`);
    if (data.byteLength !== size) throw new Error("ZIP ファイルが壊れています。");
    out.push({ path, data });
  }
  return out;
}

function findEndOfCentralDirectory(view: DataView): number {
  // 末尾のコメントは最大 65535 バイト
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

/** ファイル名。UTF-8 の印があれば UTF-8。無ければ UTF-8 として読めるか試し、だめなら Shift_JIS(日本語の Windows で作った ZIP) */
function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

/** 解凍する。書かれていた大きさを超えたら止める(大きさを偽った ZIP で、際限なく展開しないように) */
async function inflateRaw(raw: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const out = new Uint8Array(expected);
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.byteLength > expected) {
      await reader.cancel();
      throw new Error("ZIP ファイルが壊れています。");
    }
    out.set(value, n);
    n += value.byteLength;
  }
  return n === expected ? out : out.subarray(0, n);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
