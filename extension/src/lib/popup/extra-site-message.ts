// 追加の対応先に渡す記事と、入らない書き方の知らせを組み立てる(popup.ts から分けた。動きは変えていない)。
import type { buildArticle } from "../article";
import { extraSiteUnsupportedNotes } from "../../../../shared/extra-site";

/** 入らない書き方の知らせの文(無ければ空) */
export function notesText(notes: string[]): string {
  return notes.length ? `\n\n入らない書き方:\n${notes.map((n) => `・${n}`).join("\n")}` : "";
}

/** 追加の対応先に渡す記事と、入らない書き方の知らせ */
export function extraSiteMessage(article: Awaited<ReturnType<typeof buildArticle>>) {
  // 目次・埋め込み・マガジン・価格は、このページでは押せなくしてあるので知らせない。本文の書き方と画像だけ知らせる
  const notes = extraSiteUnsupportedNotes({
    html: article.html,
    insertToc: false,
    embedUrls: false,
    images: article.images,
  });
  return {
    notes,
    extraArticle: {
      title: article.title,
      hashtags: article.hashtags,
      html: article.html,
      thumbnail: article.thumbnail,
      images: article.images,
      imageNotes: article.imageNotes,
      ...(article.summary !== undefined ? { summary: article.summary } : {}),
      ...(article.category !== undefined ? { category: article.category } : {}),
      ...(article.publishScope ? { publishScope: article.publishScope } : {}),
      ...(article.readingTime !== undefined ? { readingTime: article.readingTime } : {}),
    },
  };
}
