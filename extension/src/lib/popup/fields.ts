// 「② 入れる内容を確かめる」の欄と、受け取ったファイルの表示(popup.ts から分けた。動きは変えていない)。
import { parse as parseYaml } from "yaml";
import { parseFrontMatter } from "../../../../shared/article";
import { $ } from "./dom";
import { state } from "./state";
import { titleEl, hashtagsEl, magazineEl, priceEl, thumbnailEl, fieldsEl } from "./elements";
import { destination, checkTargetNow } from "./destination";
import { renderAccountTarget } from "./account";

// GitHub から読んだ記事を少し直しても、見出し画像・本文の画像は同じフォルダから取る(state.baseUrl を残す)。
// 欄を空にしたときと、全体を貼り替えたとき(別の記事にしたとき)だけ、前の記事の取得元と本文の画像を外す
export function forgetSource() {
  state.baseUrl = undefined;
  state.bodyImageFiles = [];
  state.bodyImagesBySrc = new Map();
  state.pickedMdName = "";
  renderPicked();
}

/**
 * 「② 入れる内容を確かめる」の欄は、普段はたたんでおき、入る値を短い一覧で出す(直すときだけ「直す」で開く)。
 * 値が無いものは「なし」。タイトルが無いときは開いて知らせる
 */
export function renderFieldsSummary() {
  // マガジン・価格は note にだけある設定。追加の対応先に入れるときは入らないので、行ごと出さない(「直す」の欄も同じ。#191)
  const noteOnly = destination() !== "note";
  const rows: [string, string][] = [
    ["タイトル", titleEl.value.trim()],
    ["ハッシュタグ", hashtagsEl.value.trim()],
    ...(noteOnly
      ? []
      : ([
          ["マガジン", magazineEl.value.trim()],
          ["価格", priceEl.value.trim() ? `${priceEl.value.trim()} 円` : ""],
        ] as [string, string][])),
  ];
  const nodes: Node[] = [];
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value || (label === "タイトル" ? "(ありません。「直す」で入れてください)" : "なし");
    if (!value && label === "タイトル") dd.classList.add("missing");
    nodes.push(dt, dd);
  }
  $("fields-summary").replaceChildren(...nodes);
}

/** ユーザーが欄を直したか。直した欄は、本文の再読み取りで上書きしない(新しい md を読み込んだときはリセット) */
export const fieldsEdited = { title: false, hashtags: false, magazine: false, price: false };

export function fillFieldsFromMarkdown(md: string, opts: { newSource: boolean }): { titleMissing: boolean } {
  let title = "";
  let hashtags: string[] = [];
  let magazine = "";
  let price = "";
  state.articleNoteAccount = undefined;
  try {
    const { data, content } = parseFrontMatter(md, parseYaml);
    state.articleNoteAccount = data.noteAccount;
    title = data.title ?? content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
    hashtags = data.hashtags ?? [];
    magazine = data.magazine ?? "";
    // price が正しくないときも、ほかの欄は埋める。価格の欄には書かれていた値を出し、送るときに直し方を出す
    price = data.price ? String(data.price) : (data.priceRaw ?? "");
  } catch {
    // front matter が読めないときは空のまま出す(組み立て時に同じエラーを案内する)
  }
  if (opts.newSource) fieldsEdited.title = fieldsEdited.hashtags = fieldsEdited.magazine = fieldsEdited.price = false;
  if (!fieldsEdited.title) titleEl.value = title;
  if (!fieldsEdited.hashtags) hashtagsEl.value = hashtags.join(", ");
  if (!fieldsEdited.magazine) magazineEl.value = magazine;
  if (!fieldsEdited.price) priceEl.value = price;
  fieldsEl.hidden = false;
  renderFieldsSummary();
  renderAccountTarget();
  checkTargetNow();
  const titleMissing = !titleEl.value.trim();
  titleEl.classList.toggle("missing", titleMissing);
  return { titleMissing };
}

/** ドロップされた画像を「見出し画像」の input に入れる(ファイル選択と同じ扱いになる) */
export function setThumbnailFile(file: File) {
  const dt = new DataTransfer();
  dt.items.add(file);
  thumbnailEl.files = dt.files;
  renderPicked();
}

/** ドロップ領域に、受け取り済みのファイル名を出す */
export function renderPicked() {
  const el = $<HTMLParagraphElement>("picked");
  const parts: string[] = [];
  if (state.pickedMdName) parts.push(`md ファイル: ${state.pickedMdName}`);
  const img = thumbnailEl.files?.[0];
  if (img) parts.push(`見出し画像: ${img.name}`);
  if (state.bodyImageFiles.length) parts.push(`本文の画像: ${state.bodyImageFiles.length} 枚`);
  el.hidden = parts.length === 0;
  el.textContent = parts.length ? `受け取り済み: ${parts.join(" / ")}` : "";
}
