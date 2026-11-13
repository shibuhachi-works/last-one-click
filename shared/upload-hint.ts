// 本文の画像が note に入らなかったときに、バナーに足すひとこと(拡張の content.ts が使う)。
// gif は、note の画面で手で入れても「画像のアップロードに失敗しました」になることがある(2026-11-13 実機)。
// note のヘルプでは、画像・GIF は 1 枚 20MB まで、横幅 620px を超える画像は 620px に縮められる。
// 実機で試した範囲では、横幅 620px 以下の gif は 280 コマでも入り、620px を超えてコマ数が多い gif(640px・800px で 280 コマ)は
// 20MB よりずっと小さくても入らなかった(800px でも 80 コマなら入った)。縮める処理で失敗していると見て、横幅 620px 以下を勧める。

/** 入らなかった画像の中に gif があるか(名前の拡張子か mimeType で見る) */
export function hasGif(images: ReadonlyArray<{ name: string; mimeType?: string }>): boolean {
  return images.some((i) => i.mimeType === "image/gif" || /\.gif$/i.test(i.name));
}

/** 入らなかった画像に gif があれば、直し方のひとことを返す(無ければ空文字) */
export function gifUploadHint(images: ReadonlyArray<{ name: string; mimeType?: string }>): string {
  return hasGif(images)
    ? "gif は note が受け付けないことがあります。横幅を 620px 以下にしてください(note は 620px より広い画像を縮めますが、コマ数の多い gif では失敗することがあります)。動きを長く見せたいときは、YouTube などの URL を 1 行で書いて埋め込みにしてください"
    : "";
}
