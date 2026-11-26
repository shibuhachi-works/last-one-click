// 記事を受け取る: GitHub から読む・md ファイル・ばらばらのドロップ・記事のフォルダや ZIP(popup.ts から分けた。動きは変えていない)。
import { parse as parseYaml } from "yaml";
import { parseFrontMatter } from "../../../../shared/article";
import { findRelative, findThumbnail, pickArticleMarkdown } from "../../../../shared/bundle";
import { fetchMarkdownFromGitHub, localImageNames, localImageSrcs } from "../article";
import { setStatus } from "./dom";
import { state } from "./state";
import { markdownEl, titleEl, markdownFileEl, markdownBoxEl, MAX_MD_BYTES, fieldsEditEl } from "./elements";
import { checkTargetNow } from "./destination";
import { forgetSource, fillFieldsFromMarkdown, setThumbnailFile, renderPicked } from "./fields";

export async function loadGitHubArticle(url: string, label?: string) {
  const r = await fetchMarkdownFromGitHub(url);
  markdownEl.value = r.markdown;
  forgetSource(); // 手元の md と一緒にドロップした本文の画像は、GitHub の記事には使わない
  state.baseUrl = r.baseUrl;
  fillFieldsFromMarkdown(r.markdown, { newSource: true });
  const what = label ? `「${label}」を` : "";
  setStatus(`${what}読み込みました。`, { near: "github" });
  checkTargetNow(); // target が入れる先と合わなければ、読み込みの知らせより先にこちらを出す
}

export async function loadMarkdownFile(file: File) {
  if (file.size > MAX_MD_BYTES) throw new Error(`ファイルが大きすぎます(${Math.round(file.size / 1024)} KB。2 MB まで)。`);
  const text = await file.text();
  if (text.includes("\u0000")) throw new Error("テキストのファイル(.md)を選んでください。");
  markdownEl.value = text;
  markdownBoxEl.hidden = false;
  state.baseUrl = undefined;
  state.bodyImagesBySrc = new Map();
  state.bodyImageFiles = []; // 本文の画像は、この md と一緒に(またはあとから)ドロップしたものだけを使う
  state.pickedMdName = file.name;
  renderPicked();
  markdownFileEl.value = ""; // 同じファイルをもう一度選んでも change が出るように
  const fm = text.split(/^---\s*$/m)[1] ?? "";
  const hasThumbnail = /^thumbnail:/m.test(fm);
  const { titleMissing } = fillFieldsFromMarkdown(text, { newSource: true });
  setStatus(
    `${file.name} を読み込みました。` +
      (titleMissing ? "タイトルを入れてください。" : "") +
      (hasThumbnail ? "見出し画像も選んでください。" : ""),
    { error: titleMissing, near: "drop" },
  );
  checkTargetNow(); // target が入れる先と合わなければ、読み込みの知らせより先にこちらを出す
  if (titleMissing) {
    fieldsEditEl.open = true;
    titleEl.focus();
  }
}

/** md と画像を、ばらばらにドロップしたとき。md の本文に ![説明](ファイル名) で書いてある画像は本文の画像、それ以外の 1 枚は見出し画像にする */
export async function loadLooseFiles(files: File[]) {
  const imgs = files.filter((f) => f.type.startsWith("image/"));
  const md = files.find((f) => !f.type.startsWith("image/"));
  const got: string[] = [];
  // md を先に読む
  if (md) {
    await loadMarkdownFile(md);
    got.push(`md ファイル: ${md.name}`);
  }
  const names = localImageNames(markdownEl.value);
  const body = imgs.filter((f) => names.has(f.name.toLowerCase()));
  const thumb = imgs.find((f) => !names.has(f.name.toLowerCase()));
  if (thumb) {
    setThumbnailFile(thumb);
    got.push(`見出し画像: ${thumb.name}`);
  }
  if (body.length) {
    // 同じ名前の画像をもう一度ドロップしたら、新しいほうに置き換える
    state.bodyImageFiles = [...state.bodyImageFiles.filter((f) => !body.some((b) => b.name.toLowerCase() === f.name.toLowerCase())), ...body];
    // フォルダ・ZIP で見つけた同じ名前の画像より、あとからドロップしたほうを使う
    for (const [src, f] of state.bodyImagesBySrc) if (body.some((b) => b.name.toLowerCase() === f.name.toLowerCase())) state.bodyImagesBySrc.delete(src);
    renderPicked();
    got.push(`本文の画像: ${body.length} 枚`);
  }
  const ignored = files.filter((f) => f !== md && !body.includes(f) && f !== thumb).length;
  if (ignored) got.push(`(ほか ${ignored} 個は使いません)`);
  setStatus(`${got.join(" / ")} を受け取りました。`, { near: "drop" });
  checkTargetNow(); // target が入れる先と合わなければ、受け取りの知らせより先にこちらを出す
}

/**
 * 記事のフォルダ・ZIP をまとめて受け取ったとき。記事の md を 1 つ選び、
 * 本文に ![説明](ファイル名) で書いてある画像を本文の画像に、front matter の thumbnail に当たる画像を見出し画像にする
 * (ばらばらのドロップと違い、関係ない画像を見出し画像にはしない)
 */
export async function loadBundle(items: Array<{ path: string; file: File }>, label: string) {
  const md = pickArticleMarkdown(items);
  await loadMarkdownFile(md.file);
  state.pickedMdName = md.path;
  const imgs = items.filter((i) => i !== md && i.file.type.startsWith("image/"));
  // 本文に書いた参照先ごとに、md の場所からの相対パスで探す(別のフォルダの同じ名前の画像と取り違えない)
  const bySrc = new Map<string, File>();
  for (const src of localImageSrcs(markdownEl.value)) {
    const hit = findRelative(imgs, md.path, src);
    if (hit) bySrc.set(src, hit.file);
  }
  const body = [...new Set(bySrc.values())];
  state.bodyImagesBySrc = bySrc;
  state.bodyImageFiles = body;
  const got = [`md ファイル: ${md.path}`];
  let thumbName: string | undefined;
  try {
    thumbName = parseFrontMatter(markdownEl.value, parseYaml).data.thumbnail;
  } catch {
    // front matter が読めないときは、組み立て時に同じエラーを案内する
  }
  const thumb = findThumbnail(imgs, md.path, thumbName);
  if (thumb) {
    setThumbnailFile(thumb.file);
    got.push(`見出し画像: ${thumb.file.name}`);
  }
  renderPicked();
  if (body.length) got.push(`本文の画像: ${body.length} 枚`);
  const missingThumb = thumbName && !thumb ? `\n見出し画像(${thumbName})が見つかりません。選んでください。` : "";
  setStatus(`${label} から ${got.join(" / ")} を受け取りました。${missingThumb}`, { near: "drop" });
  checkTargetNow(); // target が入れる先と合わなければ、受け取りの知らせより先にこちらを出す
}
