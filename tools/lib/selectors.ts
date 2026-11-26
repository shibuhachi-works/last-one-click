// Playwright 版が自分で見る、note の画面のセレクタ(ログインの画面か・エディタのタイトル欄が出たか)。
// 実体はリポジトリの selectors/note.json(Chrome 拡張と共有)。note の画面に入れる工程のセレクタは、拡張が同じファイルから読む(#178)。
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateSelectorsJson } from "../../shared/selectors-schema.js";

const json = validateSelectorsJson(JSON.parse(readFileSync(path.resolve(process.cwd(), "selectors/note.json"), "utf8")));

export const NOTE = {
  loginUrlPattern: new RegExp(json.loginUrlPattern),
  title: json.title,
};
