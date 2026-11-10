// 本文に画像を入れる機能を作る前の、実機の確かめ(診断の「画像の貼り付けを試す」)。
// note のエディタの本文に、テスト用の小さな画像を 1 枚、2 つの経路で渡してみて、画像が入ったか・どう入ったかを報告する。
// 1. 貼り付け(paste イベントにファイルを載せる。スクリーンショットを貼ったときと同じ経路)
// 2. ドロップ(drop イベントにファイルを載せる。ファイルをドラッグ＆ドロップしたときと同じ経路)
// 1 で入れば 2 は試さない。ボタンは押さない(クリックは一切しない)。
// 報告には、画像の URL はホスト名までしか入れない(記事の中身や認証情報は入れない)。

export type ImageProbeResult = {
  method: "paste" | "drop";
  /** イベントがエディタに受け取られたか(preventDefault されたか) */
  handled: boolean;
  /** 本文に新しく入った画像の数 */
  added: number;
  /** 入った画像の src の種類(blob: / data: / https://ホスト名) */
  srcKinds: string[];
  /** 画像が見えるまでにかかった時間(ミリ秒)。入らなければ null */
  ms: number | null;
  /** 入った画像を包む要素(figure など)の説明 */
  wrappers: string[];
};

/** テスト用の画像(320×180 の紺地に白い文字)を PNG で作る */
export async function makeTestImage(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("テスト画像を作れませんでした");
  ctx.fillStyle = "#14213d";
  ctx.fillRect(0, 0, 320, 180);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Last One Click", 160, 82);
  ctx.font = "16px sans-serif";
  ctx.fillText("画像のテスト(消してよい)", 160, 114);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("テスト画像を作れませんでした");
  return new File([blob], "last-one-click-test.png", { type: "image/png" });
}

/** src を、ホスト名までの種類にまとめる */
export function srcKind(src: string): string {
  if (src.startsWith("blob:")) return "blob:";
  if (src.startsWith("data:")) return "data:";
  try {
    const u = new URL(src);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "(読めない src)";
  }
}

function describeWrapper(img: Element, body: Element): string {
  const parts: string[] = [];
  for (let el = img.parentElement; el && el !== body && parts.length < 3; el = el.parentElement) {
    const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    parts.push(`${el.tagName.toLowerCase()}${cls}`);
  }
  return parts.join(" < ") || "(本文の直下)";
}

async function tryOnce(body: HTMLElement, file: File, method: "paste" | "drop", waitMs: number): Promise<ImageProbeResult> {
  const before = new Set(Array.from(body.querySelectorAll("img")));
  const dt = new DataTransfer();
  dt.items.add(file);
  const ev =
    method === "paste"
      ? new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
      : new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
  body.focus();
  const started = Date.now();
  body.dispatchEvent(ev);
  const handled = ev.defaultPrevented;

  let added: HTMLImageElement[] = [];
  let ms: number | null = null;
  const until = started + waitMs;
  while (Date.now() < until) {
    added = Array.from(body.querySelectorAll("img")).filter((i) => !before.has(i));
    // アップロードが終わって https の URL に変わるまで待つ。blob: / data: のままなら最後まで待って、そのまま報告する
    if (added.length && added.every((i) => /^https?:/.test(i.src))) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (added.length) ms = Date.now() - started;
  return {
    method,
    handled,
    added: added.length,
    srcKinds: [...new Set(added.map((i) => srcKind(i.src)))],
    ms,
    wrappers: [...new Set(added.map((i) => describeWrapper(i, body)))],
  };
}

/** 貼り付け → (入らなければ)ドロップ の順に試す */
export async function probeImagePaste(body: HTMLElement, file: File, waitMs = 15_000): Promise<ImageProbeResult[]> {
  const results: ImageProbeResult[] = [];
  const paste = await tryOnce(body, file, "paste", waitMs);
  results.push(paste);
  if (paste.added === 0) results.push(await tryOnce(body, file, "drop", waitMs));
  return results;
}

export function formatImageProbe(results: ImageProbeResult[], extra: string[] = []): string {
  const lines = ["# Last One Click 画像の貼り付けの確かめ", `url: ${location.origin}${location.pathname}`, ...extra, ""];
  for (const r of results) {
    lines.push(`## ${r.method === "paste" ? "貼り付け(paste)" : "ドロップ(drop)"}`);
    lines.push(`- エディタが受け取った(preventDefault): ${r.handled ? "はい" : "いいえ"}`);
    lines.push(`- 本文に入った画像: ${r.added} 枚`);
    if (r.added) {
      lines.push(`- 画像の src: ${r.srcKinds.join(", ")}`);
      lines.push(`- 入るまで: ${r.ms} ms`);
      lines.push(`- 包んでいる要素: ${r.wrappers.join(" / ")}`);
    }
    lines.push("");
  }
  const ok = results.find((r) => r.added > 0 && r.srcKinds.some((k) => k.startsWith("https://")));
  lines.push(
    ok
      ? `結論: ${ok.method === "paste" ? "貼り付け" : "ドロップ"}で画像が入り、note にアップロードされました。`
      : results.some((r) => r.added > 0)
        ? "結論: 画像は入りましたが、アップロードされた URL になるのを確かめられませんでした(時間が足りない可能性)。"
        : "結論: どちらの経路でも画像は入りませんでした。「+」メニューの「画像」から入れる方法を調べます。",
  );
  return lines.join("\n");
}
