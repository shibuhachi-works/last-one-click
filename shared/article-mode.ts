/** 記事を追加した PR のラベルから動きを決める。ラベル名は固定。 */
export type DraftMode = "save" | "hold";
export type ArticleMode = DraftMode | "skip";

export function articleMode(labels: readonly string[], fallback: DraftMode): ArticleMode {
  for (const mode of ["skip", "hold", "save"] as const) {
    if (labels.includes(`auto-draft:${mode}`)) return mode;
  }
  return fallback;
}
