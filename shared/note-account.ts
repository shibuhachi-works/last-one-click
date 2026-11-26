// 記事が指定した note のアカウント(front matter の note_account)と、ログイン中のアカウントを比べる(#102)。
// アカウントを 2 つ持っている人が、違うアカウントで下書きを組み立てないよう、工程を始める前に止めるためだけに使う。
//
// 決まり:
// - 比べるのは note の ID(urlname。note.com/<ID> の部分)だけ。ログイン中の値は shared/current-user.ts の fetchCurrentUser() の id
// - 大文字と小文字は区別しない。先頭の「@」は付けても付けなくてもよい(`@example` と `Example` は同じ)
// - 値は比べるだけ。保存しない・外へ送らない
import type { CurrentUser } from "./current-user";

/** front matter の note_account の書き方を揃える。先頭の @ と前後の空白を外す。空なら無し */
export function normalizeNoteAccount(v: string | undefined): string | undefined {
  const s = v?.trim().replace(/^@/, "").trim();
  return s || undefined;
}

/** 2 つの ID が同じアカウントか(大文字と小文字は区別しない) */
export function sameNoteAccount(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export type NoteAccountCheck =
  /** 記事が note_account を指定していない(比べない。今までどおり) */
  | { kind: "none" }
  /** 指定と同じ(今までどおり進む) */
  | { kind: "match"; expected: string }
  /** 指定と違う(工程を始めずに止める) */
  | { kind: "mismatch"; expected: string; current: string }
  /** ログイン中のアカウント(の ID)が読めない(止めずに進み、注意を出す) */
  | { kind: "unknown"; expected: string };

export function checkNoteAccount(expected: string | undefined, current: CurrentUser | null): NoteAccountCheck {
  const want = normalizeNoteAccount(expected);
  if (!want) return { kind: "none" };
  const id = current?.id?.trim();
  if (!id) return { kind: "unknown", expected: want };
  return sameNoteAccount(id, want) ? { kind: "match", expected: want } : { kind: "mismatch", expected: want, current: id };
}

/** 違うときにバナーに出す文 */
export function noteAccountMismatchMessage(c: Extract<NoteAccountCheck, { kind: "mismatch" }>): string {
  return `ログイン中のアカウント(${c.current})が、記事の指定(${c.expected})と違います。\nアカウントを切り替えて、もう一度お試しください。`;
}

/** 読めないときにバナーに出す文 */
export function noteAccountUnknownMessage(c: Extract<NoteAccountCheck, { kind: "unknown" }>): string {
  return `アカウントを確かめられませんでした(記事の指定: ${c.expected})。投稿の前に確かめてください。`;
}
