import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectFolderFiles, findRelative, findThumbnail, mimeTypeOf, pickArticleMarkdown, type FsDirEntry, type FsFileEntry } from "./bundle.js";
import { isBundleFile } from "./zip.js";

const items = (...paths: string[]) => paths.map((path) => ({ path }));

describe("記事のフォルダ・ZIP の振り分け", () => {
  it("pickArticleMarkdown: md が 1 つならそれ。複数なら、いちばん浅い article.md / index.md", () => {
    assert.equal(pickArticleMarkdown(items("p/a.png", "p/post.md")).path, "p/post.md");
    assert.equal(pickArticleMarkdown(items("p/README.md", "p/article.md", "p/sub/article.md")).path, "p/article.md");
    assert.throws(() => pickArticleMarkdown(items("p/a.md", "p/b.md")), /2 個あり、どれが記事か決められません/);
    assert.throws(() => pickArticleMarkdown(items("p/a/article.md", "p/b/article.md")), /決められません/);
    assert.throws(() => pickArticleMarkdown(items("p/a.png")), /md ファイルが入っていません/);
  });

  it("findThumbnail: md からの相対パスで探し、無ければファイル名で探す。URL は扱わない", () => {
    const all = items("post/article.md", "post/thumbnail.png", "post/img/cover.PNG", "other/thumbnail.png");
    assert.equal(findThumbnail(all, "post/article.md", "./thumbnail.png")?.path, "post/thumbnail.png");
    assert.equal(findThumbnail(all, "post/article.md", "img/cover.png")?.path, "post/img/cover.PNG");
    assert.equal(findThumbnail(all, "post/article.md", "../other/thumbnail.png")?.path, "other/thumbnail.png");
    assert.equal(findThumbnail(all, "post/article.md", "https://x/thumbnail.png"), undefined);
    assert.equal(findThumbnail(all, "post/article.md", undefined), undefined);
    assert.equal(findThumbnail(all, "post/article.md", "missing.png"), undefined);
  });

  it("findRelative: 本文の画像は、別のフォルダにある同じ名前の画像より、書いたパスのものを選ぶ", () => {
    const all = items("post/article.md", "post/other/fig.png", "post/img/fig.png", "post/img/a b.png");
    assert.equal(findRelative(all, "post/article.md", "img/fig.png")?.path, "post/img/fig.png");
    assert.equal(findRelative(all, "post/article.md", "./other/fig.png")?.path, "post/other/fig.png");
    assert.equal(findRelative(all, "post/article.md", "img/a%20b.png")?.path, "post/img/a b.png");
    // パスで見つからなければファイル名で
    assert.equal(findRelative(all, "post/article.md", "fig.png")?.path, "post/other/fig.png");
  });

  it("mimeTypeOf", () => {
    assert.equal(mimeTypeOf("a/b.JPG"), "image/jpeg");
    assert.equal(mimeTypeOf("a.md"), "text/markdown");
    assert.equal(mimeTypeOf("a.bin"), "");
  });

  it("collectFolderFiles: フォルダをたどって md と画像を集める(readEntries は空が返るまで読む。隠しフォルダは見ない)", async () => {
    type E = FsFileEntry<string> | FsDirEntry<string>;
    const file = (name: string): E => ({ name, isFile: true, isDirectory: false, file: (ok) => ok(`file:${name}`) }) as E;
    const dir = (name: string, batches: E[][]): E =>
      ({
        name,
        isFile: false,
        isDirectory: true,
        createReader: () => {
          let i = 0;
          return { readEntries: (ok: (es: E[]) => void) => ok(batches[i++] ?? []) };
        },
      }) as unknown as E;
    const root = dir("post", [[file("article.md"), file("notes.txt")], [dir("img", [[file("fig1.png")]]), dir(".git", [[file("x.md")]])]]);
    const out = await collectFolderFiles([root], isBundleFile, 100);
    assert.deepEqual(out, [
      { path: "post/article.md", file: "file:article.md" },
      { path: "post/img/fig1.png", file: "file:fig1.png" },
    ]);
    await assert.rejects(collectFolderFiles([root], isBundleFile, 3), /多すぎます/);
  });
});
