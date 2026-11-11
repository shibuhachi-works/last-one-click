// note のエディタに対するセレクタ。
// 実体はリポジトリの selectors/note.json(Chrome 拡張と共有)。
// note の DOM が変わったら JSON だけ直せば、Playwright 版・拡張版の両方に効く。
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateSelectorsJson } from "../../shared/selectors-schema.js";
import { pwQuote, pwTextIs } from "../../shared/text-match.js";

type SelectorsJson = ReturnType<typeof validateSelectorsJson>;

const json: SelectorsJson = validateSelectorsJson(JSON.parse(readFileSync(path.resolve(process.cwd(), "selectors/note.json"), "utf8")));

/** 文言の候補リストを Playwright の完全一致セレクタに変換する(部分一致だと「下書き保存」等を拾う) */
const byText = (tag: string, texts: string[]) => pwTextIs(tag, texts);

export const NOTE = {
  /** 開いているダイアログ(モーダル)。サムネの確定ボタンはこの中だけを探す */
  dialog: 'dialog[open], [role="dialog"], [aria-modal="true"]',
  newNoteUrl: json.newNoteUrl,
  loginUrlPattern: new RegExp(json.loginUrlPattern),
  title: json.title,
  body: json.body,
  thumbnail: {
    addButton: `${json.thumbnail.addButton}, ${byText("button", json.thumbnail.addButtonText)}`,
    fileInput: json.thumbnail.fileInput,
    confirm: byText("button", json.thumbnail.confirmText),
  },
  openPublishSettings: byText("button", json.openPublishSettingsText),
  /** 「下書き保存」(draft.ts の --save だけが押す)。完全一致なので「公開」系の文字は拾わない */
  saveDraft: byText("button", ["下書き保存"]),
  publishSettings: {
    hashtagInput: json.publishSettings.hashtagInput,
    magazineItem: (name: string) =>
      json.publishSettings.magazineItem
        .split(",")
        .map((s) => `${s.trim()}:text-is(${pwQuote(name)})`)
        .join(", "),
    magazineToggle: byText("button", json.publishSettings.magazineToggleText),
    /** ★ 押さない ★ 存在確認にだけ使う */
    publishButton: byText("button", json.publishSettings.publishButtonText),
  },
} as const;
