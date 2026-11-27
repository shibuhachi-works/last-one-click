// esbuild で popup / content / background / extra-site(追加の対応先の content script)をバンドルし、静的ファイルを dist/ にコピーする。
//   node build.mjs          → 1回ビルド
//   node build.mjs --watch  → 変更を監視して再ビルド
import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const watch = process.argv.includes("--watch");
const outdir = "dist";
// 追加の対応先のセレクタ(#120)。無くても動く(shared/extra-site.ts の既定値を使う)。中身の検査も、そちらで項目ごとに行う
const EXTRA_SITE_SELECTORS_FILE = "../selectors/extra-site.json";
const extraSiteSelectors = existsSync(EXTRA_SITE_SELECTORS_FILE) ? await readFile(EXTRA_SITE_SELECTORS_FILE, "utf8") : "null";
JSON.parse(extraSiteSelectors); // 書き方の誤りは、ビルドで止める

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const options = {
  entryPoints: ["src/popup.ts", "src/content.ts", "src/background.ts", "src/extra-site.ts"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  // __EXTRA_SITE_SELECTORS__ は selectors/extra-site.json の中身(無ければ null)
  define: { __EXTRA_SITE_SELECTORS__: extraSiteSelectors },
};

const copyStatic = async () => {
  await cp("manifest.json", `${outdir}/manifest.json`);
  await cp("src/popup.html", `${outdir}/popup.html`);
  await cp("src/popup.css", `${outdir}/popup.css`);
  // アイコンは PNG だけ(icon.svg と render.mjs は元データなので ZIP に入れない)
  await cp("icons", `${outdir}/icons`, { recursive: true, filter: (src) => !src.endsWith(".svg") && !src.endsWith(".mjs") });
  await cp("../selectors/note.json", `${outdir}/selectors.json`);
};

if (watch) {
  const ctx = await context(options);
  await copyStatic();
  await ctx.watch();
  console.log("watching... (静的ファイルを変えたら再実行してください)");
} else {
  await build(options);
  await copyStatic();
  console.log(`built → ${outdir}/  (chrome://extensions で「パッケージ化されていない拡張機能を読み込む」→ このフォルダ)`);
}
