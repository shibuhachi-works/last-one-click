// 入力(貼り付けた md / GitHub URL)から ArticlePayload を組み立てる。
// URL の正規化・front matter・タイトルの決定は ../../../shared/article.ts(Playwright 版と共通)。
// ここに残るのは、ブラウザの fetch(トークンは chrome.storage)と、サムネイルを base64 で持つ部分だけ。
import { marked } from "marked";
import { parse as parseYaml } from "yaml";
import { renderArticle, resolveArticleUrl } from "../../../shared/article";
import { decideGitHubFetch, resolveThumbnailUrl } from "../../../shared/github-url";
import { CJK_EMPHASIS_EXTENSIONS } from "../../../shared/cjk-emphasis";
import { appendCreditHtml, withCreditHashtag } from "../../../shared/credit";
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
  override?: { title?: string; hashtags?: string; magazine?: string; final?: boolean };
  /** 本文の最後に「この記事は、Last One Click で下書きしました。」のリンクと、ハッシュタグ #LastOneClick を入れるか(既定は入れる) */
  creditLink?: boolean;
};

export async function buildArticle(input: BuildInput): Promise<Omit<ArticlePayload, "tabId" | "skipBodyReview" | "insertToc" | "embedUrls">> {
  const a = await renderArticle(input.markdown, { markdown: (body) => marked.parse(body, { gfm: true, breaks: true }), yaml: parseYaml }, input.override);

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
  return { title: a.title, hashtags: withCreditHashtag(a.hashtags, credit), magazine: a.magazine, html, thumbnail, createdAt: Date.now() };
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
