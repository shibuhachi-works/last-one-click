// ストアの画像が、今のポップアップ・素材から作ったものかを確かめる。
//   node store/check-screenshots.mjs          → 古ければ止まる(リリースの workflow)
//   node store/check-screenshots.mjs --warn   → 古くても止めず、注意だけ出す(ふだんの CI)
// 直し方: extension/ で npm run build && npm run screenshots(画像と screenshots.lock を作り直す)
import { readFileSync } from "node:fs";
import { LOCK_FILE, SCREENSHOT_INPUTS, inputsHash } from "./screenshot-inputs.mjs";

const warnOnly = process.argv.includes("--warn");
let locked = "";
try {
  locked = JSON.parse(readFileSync(LOCK_FILE, "utf8")).hash ?? "";
} catch {
  // lock が無い・壊れているときも「古い」として扱う
}
const now = inputsHash();
if (locked === now) {
  console.log("ストアの画像は、今のポップアップ・素材から作ったものです");
  process.exit(0);
}
const msg =
  "ストアの画像(extension/store/*.png)が、今のポップアップ・素材と合っていません。" +
  `extension/ で npm run build && npm run screenshots を実行して、画像と screenshots.lock を作り直してください(見ているファイル: ${SCREENSHOT_INPUTS.join(", ")})`;
if (warnOnly) {
  // GitHub Actions の注意として出す(止めない)
  console.log(`::warning title=ストアの画像が古い::${msg}`);
  process.exit(0);
}
console.error(msg);
process.exit(1);
