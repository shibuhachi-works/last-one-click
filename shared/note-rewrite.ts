// 開いている note の記事の編集画面を、md の内容で書き換える(#174)。拡張と DOM のテストで使う、通信しない判断だけを置く。
//
// - 書き換えるのは、すでにある記事(公開済み・下書き)の編集画面(`/notes/<記事のID>/edit`)だけ。新規作成(`/notes/new`)は今までどおり
// - note は自動では保存しない(保存・更新は人が押したときだけ)。拡張は「公開に進む」「更新する」「下書き保存」を押さないので、
//   保存せずに閉じれば記事は変わらない。拡張は前の本文を保存しない
// - 公開設定の画面に移ると記事が保存される可能性があるので、書き換えでは公開設定(ハッシュタグ・マガジン・価格・有料ライン)を入れない

const NOTE_HOSTS = new Set(["note.com", "editor.note.com"]);
const KEY = /^[A-Za-z0-9_-]+$/;

/** 編集画面の URL(`https://editor.note.com/notes/<記事のID>/edit/` など)なら記事の ID。新規作成やほかのページなら null */
export function noteEditKey(url: string | undefined): string | null {
  let u: URL;
  try {
    u = new URL(url ?? "");
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !NOTE_HOSTS.has(u.hostname)) return null;
  const m = u.pathname.match(/^\/notes\/([^/]+)\/edit\/?$/);
  if (!m || m[1] === "new" || !KEY.test(m[1]!)) return null;
  return m[1]!;
}

/**
 * front matter の note_url から記事の ID を取る。受け付ける形:
 * - 記事のページ `https://note.com/<アカウントの ID>/n/<記事の ID>`
 * - 編集画面 `https://editor.note.com/notes/<記事の ID>/edit/`
 * 読めなければ null
 */
export function noteUrlKey(noteUrl: string | undefined): string | null {
  if (!noteUrl) return null;
  const edit = noteEditKey(noteUrl.trim());
  if (edit) return edit;
  let u: URL;
  try {
    u = new URL(noteUrl.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "note.com") return null;
  const m = u.pathname.match(/^\/[^/]+\/n\/([^/]+)\/?$/);
  return m && KEY.test(m[1]!) ? m[1]! : null;
}

export type NoteUrlCheck =
  | { kind: "none" }
  | { kind: "match" }
  | { kind: "mismatch"; want: string; open: string }
  | { kind: "invalid"; raw: string };

/** md の note_url と、開いている記事の ID を比べる。note_url が無ければ比べない */
export function checkNoteUrl(noteUrl: string | undefined, openKey: string): NoteUrlCheck {
  if (!noteUrl) return { kind: "none" };
  const want = noteUrlKey(noteUrl);
  if (!want) return { kind: "invalid", raw: noteUrl };
  return want === openKey ? { kind: "match" } : { kind: "mismatch", want, open: openKey };
}

/** 書き換えない理由(比べた結果が合わないとき)。合えば null */
export function noteUrlProblem(check: NoteUrlCheck): string | null {
  if (check.kind === "mismatch") {
    return `md の note_url(${check.want})と、開いている記事(${check.open})が違います。\nnote_url の記事を開いて、もう一度お試しください。`;
  }
  if (check.kind === "invalid") {
    return `md の note_url(${check.raw})が読めません。\nhttps://note.com/<アカウントの ID>/n/<記事の ID> の形で書いてください。`;
  }
  return null;
}

/** 書き換えでは入れないもの(公開設定で入れるもの)を、バナーに並べる行にする。何も無ければ空 */
export function rewriteSkippedLines(a: { hashtags: readonly string[]; magazine?: string; price?: number; paywallAnchor?: string }): string[] {
  const out: string[] = [];
  if (a.hashtags.length) out.push(`md のハッシュタグ: ${a.hashtags.map((t) => `#${t}`).join(" ")}`);
  if (a.magazine) out.push(`md のマガジン: ${a.magazine}`);
  if (a.price) out.push(`md の価格: ${a.price} 円`);
  if (a.paywallAnchor !== undefined) out.push("md の有料ライン(「ここから有料」の印)");
  return out;
}

/** 元に戻し方。ポップアップ・バナーで同じ文にする */
export const REWRITE_UNDO_NOTE = "保存せずに閉じれば、元のままです。";
