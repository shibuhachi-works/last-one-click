// ブラウザを開かずに、記事の取得・パース・HTML 変換だけを確認する。
// note の画面に触る前に「md が正しく読めているか」を切り分けるためのもの。
//
//   npm run preview -- https://github.com/you/last-one-click/tree/main/posts/2026-10-28-xxx
//
// 結果は .preview/ に書き出す(index.html をブラウザで開けば見た目を確認できる)。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadArticle } from "./lib/article.js";

const input = process.argv[2];
if (!input) {
  console.error("使い方: npm run preview -- <GitHub の記事ディレクトリ URL>");
  process.exit(1);
}

const a = await loadArticle(input);
const out = path.resolve(process.cwd(), ".preview");
await mkdir(out, { recursive: true });

await writeFile(
  path.join(out, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>${a.title}</title>
<body style="max-width:720px;margin:40px auto;font-family:sans-serif;line-height:1.8">
<h1>${a.title}</h1>
${a.thumbnail ? `<img src="${a.thumbnail.name}" style="max-width:100%">` : ""}
<p>${a.hashtags.map((t) => `#${t}`).join(" ")}${a.magazine ? ` / マガジン: ${a.magazine}` : ""}</p>
<hr>
${a.html}
</body>`,
);
if (a.thumbnail) await writeFile(path.join(out, a.thumbnail.name), a.thumbnail.buffer);

console.log(`title    : ${a.title}`);
console.log(`hashtags : ${a.hashtags.join(", ") || "(なし)"}`);
console.log(`magazine : ${a.magazine ?? "(なし)"}`);
console.log(`thumbnail: ${a.thumbnail ? `${a.thumbnail.name} (${a.thumbnail.buffer.length} bytes)` : "(なし)"}`);
console.log(`\n→ ${path.join(out, "index.html")} をブラウザで開いて確認してください。`);
