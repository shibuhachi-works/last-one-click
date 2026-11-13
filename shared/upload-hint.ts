// 本文の画像が note に入らなかったときに、バナーに足すひとこと(拡張の content.ts が使う)。
// gif は、note の画面で手で入れても「画像のアップロードに失敗しました」になることがある(2026-11-13 実機)。
// どんな gif を受け付けないか(大きさ・縦横・コマ数)は分からないので、よくある直し方だけを伝える。

/** 入らなかった画像の中に gif があるか(名前の拡張子か mimeType で見る) */
export function hasGif(images: ReadonlyArray<{ name: string; mimeType?: string }>): boolean {
  return images.some((i) => i.mimeType === "image/gif" || /\.gif$/i.test(i.name));
}

/** 入らなかった画像に gif があれば、直し方のひとことを返す(無ければ空文字) */
export function gifUploadHint(images: ReadonlyArray<{ name: string; mimeType?: string }>): string {
  return hasGif(images)
    ? "gif は note が受け付けないことがあります(note の画面で手で入れても失敗します)。動きを見せたいときは YouTube などの URL を 1 行で書いて埋め込みにするか、png にするか、gif を小さく(横幅を狭く・コマ数を少なく)してください"
    : "";
}
