// esbuild で popup / content / background / extra-site(追加の対応先の content script)をバンドルし、静的ファイルを dist/ にコピーする。
//   node build.mjs          → 1回ビルド
//   node build.mjs --watch  → 変更を監視して再ビルド
//   EXTRA_SITE=1 node build.mjs → 開発用のビルド。追加の対応先の入口と、その 3 つの権限を有効にする(#118)。
//                               ストアに出す ZIP(package.mjs)は、いつもふつうのビルドで作る
import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isExtraSiteBuild, withExtraSite } from "./extra-site-manifest.mjs";

const watch = process.argv.includes("--watch");
const extraSite = isExtraSiteBuild(process.env);
const outdir = "dist";

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
  // shared/extra-site.ts の EXTRA_SITE_ENABLED。ふつうのビルドでは false のまま
  define: { __EXTRA_SITE__: extraSite ? "true" : "false" },
};

const copyStatic = async () => {
  if (extraSite) {
    const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
    await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(withExtraSite(manifest), null, 2)}\n`);
  } else {
    await cp("manifest.json", `${outdir}/manifest.json`);
  }
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
  if (extraSite) console.log("開発用のビルド: 追加の対応先の入口と権限を有効にしました(ストアには出さない)");
  console.log(`built → ${outdir}/  (chrome://extensions で「パッケージ化されていない拡張機能を読み込む」→ このフォルダ)`);
}
