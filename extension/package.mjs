// ストアに上げる ZIP を作る: npm run package
//   build → dist/ を release/last-one-click-<version>.zip に固める
// ZIP の中身は dist/ の中身そのもの(manifest.json が ZIP の直下に来る)。release/ はコミットしない。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const out = `release/last-one-click-${manifest.version}.zip`;

execFileSync("node", ["build.mjs"], { stdio: "inherit" });
mkdirSync("release", { recursive: true });
if (existsSync(out)) rmSync(out);
// -X: 余計なメタデータを入れない。-r: 再帰。dist の中で実行して manifest.json を直下にする
execFileSync("zip", ["-X", "-r", `../${out}`, "."], { cwd: "dist", stdio: "inherit" });
console.log(`\n→ ${out}(Chrome ウェブストアの「新しいアイテム」にこのファイルを上げる)`);
