// 記事のフォルダ・ZIP をまとめてドロップしたときの振り分け(どれが記事の md で、どれが見出し画像か)。
// 本文の画像の振り分けは body-images.ts の localImageNames(ファイル名で比べる)。

export type BundleItem = { path: string };

const MD = /\.(md|markdown)$/i;

/**
 * 記事の md を 1 つ選ぶ。md が 1 つならそれ。2 つ以上なら、いちばん浅い所にある article.md / index.md を選ぶ
 * (README.md などと並んでいても、見本と同じ名前なら選べる)。決められなければエラーにして、候補を知らせる
 */
export function pickArticleMarkdown<T extends BundleItem>(items: T[]): T {
  const mds = items.filter((i) => MD.test(i.path));
  if (mds.length === 0) throw new Error("記事の md ファイルが入っていません。");
  if (mds.length === 1) return mds[0];
  const depth = (p: string) => p.split("/").length;
  const named = mds
    .filter((i) => /^(article|index)\.(md|markdown)$/i.test(baseName(i.path)))
    .sort((a, b) => depth(a.path) - depth(b.path));
  if (named.length && (named.length === 1 || depth(named[0].path) < depth(named[1].path))) return named[0];
  const list = mds.slice(0, 5).map((i) => i.path).join(", ");
  throw new Error(`md ファイルが ${mds.length} 個あり、どれが記事か決められません(${list}${mds.length > 5 ? " ほか" : ""})。記事の md を article.md という名前にするか、1 記事ずつドロップしてください。`);
}

/**
 * front matter の thumbnail(./thumbnail.png など)に当たる画像を探す。
 * md の場所からの相対パスで探し、無ければファイル名で探す(大文字・小文字は区別しない)
 */
export function findThumbnail<T extends BundleItem>(items: T[], mdPath: string, thumbnail: string | undefined): T | undefined {
  return findRelative(items, mdPath, thumbnail);
}

/**
 * md の場所からの相対パス(本文の画像・thumbnail)に当たるファイルを探す。パスで見つからなければファイル名で探す
 * (別のフォルダに同じ名前の画像があっても、書いたパスのものを先に選ぶ)
 */
export function findRelative<T extends BundleItem>(items: T[], mdPath: string, rel: string | undefined): T | undefined {
  if (!rel || /^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith("/")) return undefined;
  let path = rel.trim().split(/[?#]/)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // %xx が壊れていれば書いたまま
  }
  const want = joinPath(dirName(mdPath), path).toLowerCase();
  const byPath = items.find((i) => i.path.toLowerCase() === want);
  if (byPath) return byPath;
  const name = baseName(want);
  return items.find((i) => baseName(i.path).toLowerCase() === name && !MD.test(i.path));
}

function baseName(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

function dirName(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/** dir と相対パスをつなぐ(./ と ../ をたたむ) */
function joinPath(dir: string, rel: string): string {
  const out = dir ? dir.split("/") : [];
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** 拡張子から画像の MIME タイプ(ZIP から取り出したファイルには型が無いので付ける)。md は text/markdown */
export function mimeTypeOf(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return (
    ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", md: "text/markdown", markdown: "text/markdown" } as Record<string, string>)[ext] ?? ""
  );
}

// ---- フォルダのドロップ(webkitGetAsEntry の FileSystemEntry をたどる) ----
// 型は使う分だけ書く(ルートの tsconfig には DOM の型が無い)

type FsEntry = { name: string; isFile: boolean; isDirectory: boolean };
export type FsFileEntry<F> = FsEntry & { isFile: true; file: (ok: (f: F) => void, ng?: (e: unknown) => void) => void };
export type FsDirEntry<F> = FsEntry & { isDirectory: true; createReader: () => { readEntries: (ok: (es: Array<FsFileEntry<F> | FsDirEntry<F>>) => void, ng?: (e: unknown) => void) => void } };

/**
 * ドロップされたフォルダの中の、md と画像のファイルを集める(path はドロップしたフォルダからの相対パス)。
 * 隠しファイル・__MACOSX は見ない。たどるファイル数に上限を付ける
 */
export async function collectFolderFiles<F>(
  roots: Array<FsFileEntry<F> | FsDirEntry<F>>,
  keep: (path: string) => boolean,
  maxEntries: number,
): Promise<Array<{ path: string; file: F }>> {
  const out: Array<{ path: string; file: F }> = [];
  let seen = 0;
  async function walk(entry: FsFileEntry<F> | FsDirEntry<F>, prefix: string): Promise<void> {
    if (entry.name.startsWith(".") || entry.name === "__MACOSX") return;
    if (++seen > maxEntries) throw new Error(`フォルダの中のファイルが多すぎます(${maxEntries} 個まで)。記事のフォルダだけをドロップしてください。`);
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      if (!keep(path)) return;
      const file = await new Promise<F>((ok, ng) => (entry as FsFileEntry<F>).file(ok, ng));
      out.push({ path, file });
      return;
    }
    const reader = (entry as FsDirEntry<F>).createReader();
    // readEntries は一度に全部を返さないことがあるので、空が返るまで読む
    for (;;) {
      const batch = await new Promise<Array<FsFileEntry<F> | FsDirEntry<F>>>((ok, ng) => reader.readEntries(ok, ng));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, path);
    }
  }
  for (const r of roots) await walk(r, "");
  return out;
}
