// 本文の画像の上限(枚数・合計の大きさ)と、同じ画像・画像でないファイルの扱い(#99)。
// 拡張の buildArticle は collectBodyImageFiles に判定を任せる(extension/src/lib/article.ts)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Marked } from "marked";
import { MAX_BODY_IMAGES, MAX_PENDING_BYTES, base64Size, collectBodyImageFiles, makeImageRenderer, type BodyImageRef } from "./body-images.js";
import { SAFE_RENDERER } from "./markdown-safe.js";

type FakeFile = { name: string; size: number; type: string };

/** md を拡張と同じ形で変換して、目印にした画像を集める */
function refsOf(markdown: string): BodyImageRef[] {
  const refs: BodyImageRef[] = [];
  new Marked({ gfm: true, breaks: true, renderer: { ...SAFE_RENDERER, image: makeImageRenderer(refs, SAFE_RENDERER.image, "t0g0") } as never }).parse(markdown);
  return refs;
}

function loader(files: Record<string, FakeFile>) {
  const calls: string[] = [];
  return { calls, load: async (src: string) => (calls.push(src), files[src] ?? null) };
}

const toPayload = async (f: FakeFile) => ({ name: f.name, mimeType: f.type, base64: "x".repeat(base64Size(f.size)) });
const png = (name: string, size = 10): FakeFile => ({ name, size, type: "image/png" });

describe("本文の画像の上限(#99)", () => {
  it("21 枚ある記事: 20 枚だけ入れ、超えた 1 枚を知らせる", async () => {
    const names = Array.from({ length: 21 }, (_, i) => `img${i + 1}.png`);
    const refs = refsOf(names.map((n) => `![](${n})`).join("\n\n"));
    assert.equal(refs.length, 21);
    const { load, calls } = loader(Object.fromEntries(names.map((n) => [n, png(n)])));
    const { images, imageNotes } = await collectBodyImageFiles(refs, MAX_PENDING_BYTES, load, toPayload);
    assert.equal(images.length, MAX_BODY_IMAGES);
    assert.deepEqual(images.map((i) => i.name), names.slice(0, 20));
    assert.ok(!calls.includes("img21.png"), "21 枚目は読まない");
    assert.deepEqual(imageNotes, ["本文の画像が 21 枚あり、上限の 20 枚を超えた 1 枚は入れていません"]);
  });

  it("合計が残りの大きさを超える記事: 超えた画像は入れず、入った分は残りの大きさを超えない", async () => {
    const refs = refsOf("![](a.png)\n\n![](big.png)\n\n![](c.png)\n");
    const budget = base64Size(300);
    const { load } = loader({ "a.png": png("a.png", 200), "big.png": png("big.png", 200), "c.png": png("c.png", 90) });
    const { images, imageNotes } = await collectBodyImageFiles(refs, budget, load, toPayload);
    assert.deepEqual(images.map((i) => i.name), ["a.png", "c.png"]);
    const total = images.reduce((n, i) => n + i.base64.length, 0);
    assert.ok(total <= budget, `${total} <= ${budget}`);
    assert.equal(imageNotes.length, 1);
    assert.match(imageNotes[0], /^画像の合計が大きすぎるため入れていない画像があります\(big\.png。/);
  });

  it("同じ画像を 2 回使う記事: ファイルは 1 回だけ読み、2 か所とも入れる", async () => {
    const refs = refsOf("![1](same.png)\n\n間の文\n\n![2](same.png)\n");
    const { load, calls } = loader({ "same.png": png("same.png") });
    const { images, imageNotes } = await collectBodyImageFiles(refs, MAX_PENDING_BYTES, load, toPayload);
    assert.deepEqual(calls, ["same.png"]);
    assert.equal(images.length, 2);
    assert.deepEqual(images.map((i) => i.marker), refs.map((r) => r.marker));
    assert.notEqual(images[0].marker, images[1].marker);
    assert.deepEqual(imageNotes, []);
  });

  it("画像でないファイル・読めないファイルは、見つからなかった画像として知らせる", async () => {
    const refs = refsOf("![](notes.txt)\n\n![](ok.png)\n\n![](none.png)\n\n![](err.png)\n");
    const files: Record<string, FakeFile> = { "notes.txt": { name: "notes.txt", size: 5, type: "text/plain" }, "ok.png": png("ok.png") };
    const load = async (src: string) => {
      if (src === "err.png") throw new Error("取得失敗");
      return files[src] ?? null;
    };
    const { images, imageNotes } = await collectBodyImageFiles(refs, MAX_PENDING_BYTES, load, toPayload);
    assert.deepEqual(images.map((i) => i.name), ["ok.png"]);
    assert.deepEqual(imageNotes, ["見つからなかった画像があります(notes.txt, none.png, err.png)"]);
  });

  it("説明(title)のある画像は caption を付ける。画像が無い記事は何も知らせない", async () => {
    const refs = refsOf('![図](a.png "図1 の説明")\n');
    const { load } = loader({ "a.png": png("a.png") });
    const { images } = await collectBodyImageFiles(refs, MAX_PENDING_BYTES, load, toPayload);
    assert.equal(images[0].caption, "図1 の説明");
    assert.deepEqual(await collectBodyImageFiles([], MAX_PENDING_BYTES, load, toPayload), { images: [], imageNotes: [] });
  });
});
