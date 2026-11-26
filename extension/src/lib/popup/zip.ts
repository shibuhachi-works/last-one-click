// ドロップされた ZIP を読む(popup.ts から分けた。動きは変えていない)。
import { mimeTypeOf } from "../../../../shared/bundle";
import { readZip } from "../../../../shared/zip";

export const MAX_ZIP_FILE_BYTES = 60 * 1024 * 1024;

export function isZip(f: File): boolean {
  return /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";
}

/** ZIP の中の md と画像を、File にして返す(path は ZIP の中のパス) */
export async function zipItems(zip: File): Promise<Array<{ path: string; file: File }>> {
  if (zip.size > MAX_ZIP_FILE_BYTES) throw new Error(`ZIP ファイルが大きすぎます(${MAX_ZIP_FILE_BYTES / 1024 / 1024}MB まで)。`);
  const entries = await readZip(new Uint8Array(await zip.arrayBuffer()));
  return entries.map((e) => ({ path: e.path, file: new File([e.data as BlobPart], e.path.slice(e.path.lastIndexOf("/") + 1), { type: mimeTypeOf(e.path) }) }));
}
