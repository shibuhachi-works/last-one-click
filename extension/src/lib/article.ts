// 入力(貼り付けた md / GitHub URL)から ArticlePayload を組み立てる。
// URL の正規化・front matter・タイトルの決定は ../../../shared/article.ts(Playwright 版と共通)。
// ここに残るのは、ブラウザの fetch(トークンは chrome.storage)と、サムネイルを base64 で持つ部分だけ。
import { Marked, marked } from "marked";
import { parse as parseYaml } from "yaml";
import { checkTarget, renderArticle, resolveArticleUrl, type Destination } from "../../../shared/article";
import { decideGitHubFetch, resolveThumbnailUrl } from "../../../shared/github-url";
import { CJK_EMPHASIS_EXTENSIONS } from "../../../shared/cjk-emphasis";
import { appendCreditHtml, withCreditHashtag } from "../../../shared/credit";
import { MAX_PENDING_BYTES, collectBodyImageFiles, findDroppedImage, imageFileName, makeImageRenderer, makeMarkerTag, localImageNames as sharedLocalImageNames, localImageSrcs as sharedLocalImageSrcs, type BodyImageRef } from "../../../shared/body-images";
import { SAFE_RENDERER } from "../../../shared/markdown-safe";
import { STORAGE, type ArticlePayload } from "./types";

// 記事に書かれた生の HTML は通さず、javascript: などのリンクも落とす
marked.use({ renderer: SAFE_RENDERER as never });
// 日本語の **「…」** の形(かぎかっこや句読点に接した強調)も太字にする
marked.use({ extensions: CJK_EMPHASIS_EXTENSIONS as never });

export type BuildInput = {
  markdown: string;
  /** popup で選んだ画像。front matter の thumbnail より優先 */
  thumbnailFile?: File | null;
  /** md を GitHub から取った場合、相対パスの thumbnail を解決する基準 */
  baseUrl?: string;
  /** popup のフォームで上書きした値(空なら front matter を使う) */
  override?: { title?: string; hashtags?: string; magazine?: string; price?: string; final?: boolean; ignorePaywall?: boolean };
  /** 本文の最後に「この記事は、Last One Click で下書きしました。」のリンクと、ハッシュタグ #LastOneClick を入れるか(既定は入れる) */
  creditLink?: boolean;
  /** 本文の相対パスの画像(![説明](image1.png))を、note の本文に入れるか(「本文の画像を入れる」のチェック) */
  insertImages?: boolean;
  /** 手元の md のときに一緒にドロップされた画像(本文の画像の候補)。GitHub から読んだときは使わない */
  bodyImageFiles?: File[];
  /** 記事のフォルダ・ZIP から、本文に書いた参照先(相対パス)ごとに見つけた画像。bodyImageFiles より先に使う */
  bodyImagesBySrc?: Map<string, File>;
  /** 入れる先。front matter の target と合わなければ、画像を取りに行く前に止める(checkTarget) */
  destination?: Destination;
};

/** 本文の画像を目印にする変換。refs に、どの画像をどこに入れるかが集まる */
function imageParser(refs: BodyImageRef[], markdown: string): Marked {
  return new Marked({
    gfm: true,
    breaks: true,
    renderer: { ...SAFE_RENDERER, image: makeImageRenderer(refs, SAFE_RENDERER.image, makeMarkerTag(markdown)) } as never,
    extensions: CJK_EMPHASIS_EXTENSIONS as never,
  });
}

/** md の本文に、ファイル名で書いた画像のファイル名(小文字)。ドロップされた画像の振り分けに使う(shared/body-images.ts) */
export function localImageNames(markdown: string): Set<string> {
  return sharedLocalImageNames(Marked as never, markdown, SAFE_RENDERER.image);
}

/** md の本文に、ファイル名(相対パス)で書いた画像の参照先。記事のフォルダ・ZIP の中から相対パスで探すのに使う */
export function localImageSrcs(markdown: string): string[] {
  return sharedLocalImageSrcs(Marked as never, markdown, SAFE_RENDERER.image);
}

export async function buildArticle(input: BuildInput): Promise<Omit<ArticlePayload, "tabId" | "skipBodyReview" | "insertToc" | "embedUrls">> {
  // 本文の画像を入れるときは、相対パスの画像を目印の文字にして、どの画像をどこに入れるかを集める
  const refs: BodyImageRef[] = [];
  const parser = input.insertImages ? imageParser(refs, input.markdown) : marked;
  // 印がコードの中かを確かめる変換(probe)は、本文の画像を集めない marked にする(imageParser は呼ぶたびに refs に足すため)
  const a = await renderArticle(
    input.markdown,
    {
      markdown: (body) => parser.parse(body, { gfm: true, breaks: true }) as string,
      probe: (body) => marked.parse(body, { gfm: true, breaks: true }) as string,
      yaml: parseYaml,
    },
    input.override,
  );
  checkTarget(a.target, input.destination ?? "note");

  let thumbnail: ArticlePayload["thumbnail"];
  if (input.thumbnailFile) {
    thumbnail = await fileToPayload(input.thumbnailFile);
  } else if (a.thumbnail && input.baseUrl) {
    const url = resolveThumbnailUrl(a.thumbnail, input.baseUrl);
    // 記事と同じ repo のときだけトークンを付ける。raw 以外は取りに行かない
    const res = await fetchGitHub(url, input.baseUrl);
    const blob = await res.blob();
    thumbnail = await fileToPayload(new File([blob], url.slice(url.lastIndexOf("/") + 1), { type: blob.type }));
  }

  // 本文の最後に「この記事は、Last One Click で下書きしました。」を足す。md ではなく変換後の HTML に足す
  // (記事の最後が閉じていないコードブロックや、先頭の --- に左右されないように)。「読み込んだ内容」の欄には足さない
  const credit = input.creditLink ?? true;
  const html = appendCreditHtml(a.html, credit);
  // 本文の画像は、本文と見出し画像を入れたうえで、保存できる残りの大きさまで入れる
  const used = new TextEncoder().encode(html).length + (thumbnail?.base64.length ?? 0);
  const { images, imageNotes } = await collectBodyImages(refs, input, MAX_PENDING_BYTES - used);
  return { title: a.title, hashtags: withCreditHashtag(a.hashtags, credit), magazine: a.magazine, ...(a.price ? { price: a.price } : {}), ...(a.paywallAnchor !== undefined ? { paywallAnchor: a.paywallAnchor } : {}), ...(a.noteAccount ? { noteAccount: a.noteAccount } : {}), ...(a.noteUrl ? { noteUrl: a.noteUrl } : {}), ...(a.summary !== undefined ? { summary: a.summary } : {}), ...(a.category !== undefined ? { category: a.category } : {}), ...(a.publishScope ? { publishScope: a.publishScope } : {}), ...(a.readingTime !== undefined ? { readingTime: a.readingTime } : {}), html, thumbnail, images, imageNotes, createdAt: Date.now() };
}

/**
 * 目印にした画像のファイルを集める。上限(枚数・合計の大きさ)の判定は shared/body-images.ts の collectBodyImageFiles
 */
async function collectBodyImages(refs: BodyImageRef[], input: BuildInput, budget: number): Promise<{ images: NonNullable<ArticlePayload["images"]>; imageNotes: string[] }> {
  return collectBodyImageFiles(refs, budget, (src) => loadBodyImage(src, input), fileToPayload);
}

/** GitHub から読んだ記事なら、記事と同じフォルダから取る。手元の md なら、一緒にドロップされた画像から探す */
async function loadBodyImage(src: string, input: BuildInput): Promise<File | null> {
  if (input.baseUrl) {
    const url = resolveThumbnailUrl(src, input.baseUrl);
    const res = await fetchGitHub(url, input.baseUrl);
    const blob = await res.blob();
    return new File([blob], imageFileName(src), { type: blob.type || guessImageType(src) });
  }
  return input.bodyImagesBySrc?.get(src) ?? findDroppedImage(input.bodyImageFiles ?? [], src) ?? null;
}

function guessImageType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as Record<string, string>)[ext] ?? "";
}

export async function fileToPayload(file: File): Promise<NonNullable<ArticlePayload["thumbnail"]>> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  return { name: file.name, mimeType: file.type || "image/png", base64 };
}

/** fileToPayload の逆。ポップアップ間で画像を受け渡すときに使う */
export function payloadToFile(t: NonNullable<ArticlePayload["thumbnail"]>): File {
  const bin = atob(t.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], t.name, { type: t.mimeType });
}

/**
 * raw.githubusercontent.com からだけ取る。`scopeBase`(記事の md の場所)を渡すと、
 * 同じ owner/repo のときだけトークンを付ける。
 */
export async function fetchGitHub(url: string, scopeBase?: string): Promise<Response> {
  const decision = decideGitHubFetch(url, scopeBase);
  if (!decision.allowed) throw new Error(decision.reason);
  const headers: Record<string, string> = {};
  if (decision.sendToken) {
    const { [STORAGE.githubToken]: token } = await chrome.storage.local.get(STORAGE.githubToken);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`取得失敗 ${res.status}: ${url}`);
  return res;
}

export async function fetchMarkdownFromGitHub(input: string): Promise<{ markdown: string; baseUrl: string }> {
  const { mdUrl, baseUrl } = resolveArticleUrl(input);
  return { markdown: await (await fetchGitHub(mdUrl)).text(), baseUrl };
}
