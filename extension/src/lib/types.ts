/** popup → content script に渡す、組み立て済みの記事 */
export type ArticlePayload = {
  title: string;
  hashtags: string[];
  magazine?: string;
  /** note に貼り付ける HTML */
  html: string;
  /** base64 で持ち回る(chrome.storage に入れるため) */
  thumbnail?: { name: string; mimeType: string; base64: string };
  /** 作成時刻。古すぎる pending を無視するため */
  createdAt: number;
  /**
   * ポップアップが開いたタブの ID。content script は自分のタブがこれと一致するときだけ動く。
   * タブを開く前に保存するので、最初は null。開いた直後に埋める
   */
  tabId: number | null;
  /**
   * 本文の確認を飛ばして公開設定まで一気に進むか。
   * false(既定)なら、タイトル・本文・見出し画像を入れたところで止まり、バナーの「公開設定を入れる」を待つ
   */
  skipBodyReview: boolean;
  /** 本文の先頭に note の目次を入れるか(「記事の先頭に目次を入れる」のチェック) */
  insertToc: boolean;
  /** URL だけの行を note の埋め込み(カード)にするか(「URL だけの行を埋め込みにする」のチェック) */
  embedUrls: boolean;
  /** 本文の画像。本文の中の目印(［画像1: image1.png］)の位置に、この画像を貼り付ける(#51) */
  images?: { marker: string; name: string; mimeType: string; base64: string }[];
  /** 本文の画像で、入れられなかったもの(上限・見つからない・大きすぎる)の知らせ。バナーに出す */
  imageNotes?: string[];
};

/** selectors/note.json の形(検査は shared/selectors-schema.ts) */
import type { SelectorsJson } from "../../../shared/selectors-schema";
export type Selectors = SelectorsJson;

/** popup ⇄ content script ⇄ service worker のメッセージ */
export type Message = { type: "diagnose" } | { type: "whoami" } | { type: "selectors" };
export type WhoAmIResponse = { tabId: number | null };
/**
 * content script → service worker。content script は note.com の origin で動くので、
 * 同梱の selectors.json(chrome-extension://)も GitHub も自分では fetch できない。service worker が代わりに読む
 */
export type SelectorsResponse =
  | { ok: true; selectors: Selectors; source: "remote" | "cache" | "bundled"; warning?: string }
  | { ok: false; error: string };
export type DiagnoseResponse = { ok: true; report: string } | { ok: false; error: string };

/** chrome.storage.local のキー */
export const STORAGE = {
  pendingArticle: "pendingArticle",
  selectorsUrl: "selectorsUrl",
  selectorsCache: "selectorsCache",
  githubToken: "githubToken",
  /** GitHub 連携と上級者向けの設定を表示するか(「拡張機能の設定」のチェックで切り替わる) */
  advancedMode: "advancedMode",
  /** 「本文の確認を飛ばして、公開設定まで進む」のチェック(覚えておく) */
  skipBodyReview: "skipBodyReview",
  /** 「記事の最後に『Last One Click で下書きしました』のリンクを入れる」のチェック(覚えておく。値が無いときは入れる) */
  creditLink: "creditLink",
  /** 「記事の先頭に目次を入れる」のチェック(覚えておく) */
  insertToc: "insertToc",
  /** 「URL だけの行を埋め込みにする」のチェック(覚えておく) */
  embedUrls: "embedUrls",
  /** 「本文の画像を入れる」のチェック(覚えておく。値が無いときは入れる) */
  insertImages: "insertImages",
  /** 「ウィンドウで開く」で入力途中の状態を新しいウィンドウへ渡す(chrome.storage.session。受け取ったら消す) */
  windowHandoff: "windowHandoff",
} as const;

/** ポップアップ → 別ウィンドウに引き継ぐ入力状態 */
export type WindowHandoff = {
  markdown: string;
  title: string;
  hashtags: string;
  magazine: string;
  baseUrl?: string;
  /** ドロップ領域に出している md のファイル名(GitHub や貼り付け由来なら空) */
  mdName?: string;
  /** 欄をユーザーが直したか(移動先でも、直した欄を本文の再読み取りで上書きしないため) */
  fieldsEdited?: { title: boolean; hashtags: boolean; magazine: boolean };
  thumbnail?: ArticlePayload["thumbnail"];
  /** 大きすぎて渡せなかった画像の名前(新しい側で再選択を案内する) */
  skippedImageName?: string;
};
