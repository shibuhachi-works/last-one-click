// 記事の取得・パース・HTML 変換。ブラウザには一切触らない純粋なロジック。
// URL の正規化・front matter・タイトルの決定は shared/article.ts(拡張と共通)。
// ここに残るのは Node の fetch(トークンは環境変数)と、サムネイルを Buffer で持つ部分だけ。
import { marked } from "marked";
import { parse as parseYaml } from "yaml";
import { renderArticle } from "../../shared/article.js";
import { decideGitHubFetch, resolveThumbnailUrl } from "../../shared/github-url.js";
import { CJK_EMPHASIS_EXTENSIONS } from "../../shared/cjk-emphasis.js";
import { SAFE_RENDERER } from "../../shared/markdown-safe.js";

export { resolveArticleUrl } from "../../shared/article.js";
import { resolveArticleUrl } from "../../shared/article.js";

// 記事に書かれた生の HTML は通さず、javascript: などのリンクも落とす
marked.use({ renderer: SAFE_RENDERER as never });
// 日本語の **「…」** の形(かぎかっこや句読点に接した強調)も太字にする
marked.use({ extensions: CJK_EMPHASIS_EXTENSIONS as never });

export type Article = {
  title: string;
  hashtags: string[];
  magazine?: string;
  /** 本文を note に貼り付けるための HTML */
  html: string;
  /** サムネイル画像(front matter で指定がなければ undefined) */
  thumbnail?: { name: string; mimeType: string; buffer: Buffer };
};

/**
 * raw.githubusercontent.com からだけ取る。`scopeBase`(記事の md の場所)を渡すと、
 * 同じ owner/repo のときだけ GITHUB_TOKEN を付ける。
 */
async function fetchRaw(url: string, scopeBase?: string): Promise<Response> {
  const decision = decideGitHubFetch(url, scopeBase);
  if (!decision.allowed) throw new Error(decision.reason);
  const headers: Record<string, string> = {};
  if (decision.sendToken && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`取得失敗 ${res.status} ${res.statusText}: ${url}`);
  return res;
}

export async function loadArticle(input: string): Promise<Article> {
  const { mdUrl, baseUrl } = resolveArticleUrl(input);
  const md = await (await fetchRaw(mdUrl)).text();
  const a = await renderArticle(md, { markdown: (body) => marked.parse(body, { gfm: true, breaks: true }), yaml: parseYaml });

  let thumbnail: Article["thumbnail"];
  if (a.thumbnail) {
    const thumbUrl = resolveThumbnailUrl(a.thumbnail, baseUrl);
    const res = await fetchRaw(thumbUrl, baseUrl);
    const name = thumbUrl.slice(thumbUrl.lastIndexOf("/") + 1);
    thumbnail = {
      name,
      mimeType: res.headers.get("content-type") ?? guessMime(name),
      buffer: Buffer.from(await res.arrayBuffer()),
    };
  }

  return { title: a.title, hashtags: a.hashtags, magazine: a.magazine, html: a.html, thumbnail };
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop();
  return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" }[ext ?? ""] ?? "application/octet-stream";
}
