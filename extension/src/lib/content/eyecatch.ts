// 見出し画像を入れる工程(content.ts から分けた。動きは変えていない)。
import { describe, rect } from "../diagnose";
import { findEyecatchButton } from "../../../../shared/eyecatch-button";
import { safeKey, safePress } from "../safe-click";
import { installFilePickerGuard, type FilePickerGuard } from "../../../../shared/file-picker-guard";
import { type ArticlePayload, type Selectors } from "../types";
import { StopError } from "./banner";
import { findAllByText, findSmallestByText, canvasHasContent, describeShort, waitUntil, findByText, findDialog, base64ToFile, sleep } from "./dom";

export async function setThumbnail(S: Selectors, a: ArticlePayload, opts: { guessButton?: boolean } = {}) {
  if (!a.thumbnail) return "なし";
  const file = base64ToFile(a.thumbnail);

  // note がファイル選択ダイアログ(Finder など)を開こうとしたら止めて、その input に画像を渡す。
  // 拡張のクリックは合成イベントなのでふつうは開かないが、人が直前にタブを触っているとブラウザが開いてしまう
  const guard = installFilePickerGuard();
  try {
    return await setThumbnailGuarded(S, file, guard, opts.guessButton ?? true);
  } finally {
    guard.stop();
  }
}

export async function setThumbnailGuarded(S: Selectors, file: File, guard: FilePickerGuard, guessButton: boolean) {
  // (1) file input が DOM にあれば直接セット(hidden でも可)
  let input = document.querySelector<HTMLInputElement>(S.thumbnail.fileInput);
  if (!input) {
    // (2) 見出し画像のボタンを押すとメニューと一緒に file input が出てくる(実機: #note-editor-eyecatch-input は
    //     メニューを開いたときだけ DOM にある)。ボタンは selectors の指定 → 文字 → タイトル欄の上のアイコンボタンの順で探す
    const title = document.querySelector<HTMLElement>(S.title);
    const btn =
      document.querySelector<HTMLElement>(S.thumbnail.addButton) ??
      findByText("button", S.thumbnail.addButtonText) ??
      (title && guessButton ? findEyecatchButton(title) : null);
    if (!btn && !guessButton) throw new Error("見出し画像のボタンが見つかりません。画面で差し替えてください。");
    if (!btn) throw new Error("見出し画像のボタンが見つかりません。画面で入れてください。");
    input = await activateEyecatchButton(S, btn, guard);
  }

  // 確定ボタン(「保存」)は、画像を入れたあとに新しく現れたものだけを押す。
  // 画面にもとからある「保存」(例: 下書き保存)は完全一致でも押さないよう、入れる前の一覧を控えておく
  const confirmBefore = new Set(findAllByText("button", S.thumbnail.confirmText));

  const imagesBefore = new Set(Array.from(document.querySelectorAll("img, canvas")));
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  // トリミング確認が出たら、その中(ダイアログ内、または新しく現れた)の確定ボタンだけを押す
  const confirm = await waitForConfirm(S.thumbnail.confirmText, confirmBefore, 20_000);
  if (!confirm) throw new StopError("トリミングの「保存」が見つかりません。出ていれば押してください");

  // 「保存」が現れた直後は画像がまだ読み込まれていないことがある(実機: ✓ なのに記事に画像が付かなかった)。
  // 渡した画像がダイアログ(無ければページ)に表示されるまで待ってから押す。表示されなければ押さない
  // 回線やサーバーの調子で時間が変わるので、待ち時間は長めに取る
  const dialog = confirm.closest<HTMLElement>('dialog, [role="dialog"], [aria-modal="true"]');
  const freshImage = (root: ParentNode) =>
    Array.from(root.querySelectorAll<HTMLImageElement | HTMLCanvasElement>("img, canvas"))
      .filter((el) => !imagesBefore.has(el))
      .find((el) => (el instanceof HTMLImageElement ? el.complete && el.naturalWidth > 0 : canvasHasContent(el))) ?? null;
  const loaded = await waitUntil(() => freshImage(dialog ?? document), 30_000);
  if (!loaded) {
    // トリミング画面が開いたままの可能性があるので、後続(公開設定への移動)には進まない
    throw new StopError("トリミング画面に画像が出ません。出ていれば「保存」を押してください");
  }
  await sleep(1_000); // 描画が落ち着くまで
  const label = (confirm.textContent ?? "").trim();
  const cr = confirm.getBoundingClientRect();
  safePress(confirm, "setThumbnail.confirm", { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 }).release({ click: true });

  // 「保存」のあとはアップロードが走る。トリミング画面が閉じて、記事側に見出し画像が表示されるまで待ってから次へ進む
  // (すぐ公開設定へ移るとアップロードが途中で切れる可能性がある)
  const shown = await waitUntil(() => {
    const dialogOpen = dialog ? dialog.isConnected : Boolean(findDialog());
    if (dialogOpen) return null;
    return freshImage(document);
  }, 60_000);
  if (!shown) {
    throw new StopError(
      `見出し画像の表示を確認できませんでした`,
    );
  }
  await sleep(1_500); // 保存処理が落ち着くまで
  return "表示されました";
}

/**
 * 見出し画像のボタンを押してメニューを開き、画像の file input を返す。
 * 実機(test11)では正しいボタンに pointerdown → click を送ってもメニューが開かなかったので、実際の操作に近い順で試す:
 * (1) ボタンの中心にある要素(重なっている要素があればそれ)に hover → pointerdown → mousedown、(2) 続けて click、
 * (3) Enter キー、(4) Space キー。それぞれの後で「入力欄」か「メニューの『画像をアップロード』」が出たかを見る。
 * メニューが出たら「画像をアップロード」を押す(入力欄はこのときに作られる可能性がある。ファイル選択ダイアログは
 * ユーザー操作なしでは開かないので、出た入力欄にファイルを直接入れる)。
 * 出なければ、どこまで試して何が起きたかをエラー文に出す(バナーのスクリーンショットだけで次の手を決めるため)
 */
export async function activateEyecatchButton(S: Selectors, btn: HTMLElement, guard: FilePickerGuard): Promise<HTMLInputElement> {
  // ダイアログを止めたときの input(note がまさに使おうとしたもの)を優先し、無ければセレクタで探す
  const fileInput = () => guard.input() ?? document.querySelector<HTMLInputElement>(S.thumbnail.fileInput);
  const menuItem = () => findSmallestByText(S.thumbnail.uploadMenuText, S.body);
  const appeared = (ms: number) => waitUntil(() => fileInput() ?? menuItem(), ms);
  const log: string[] = [];

  const r = btn.getBoundingClientRect();
  const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  // 中心にあるのが SVG(click() が無い)などなら、ボタン自身に送る(子からのイベントと同じくボタンのハンドラに届く)
  const atPoint = document.elementFromPoint(at.x, at.y);
  const target = atPoint instanceof HTMLElement && (btn.contains(atPoint) || atPoint.contains(btn)) ? atPoint : btn;
  if (atPoint && atPoint !== btn) log.push(`中心の要素: ${describe(atPoint as HTMLElement)}${target === btn ? "(ボタンの外なので、ボタン自身に送る)" : ""}`);

  // 押している間に DOM へ新しく現れた要素を記録する(メニューが開いたのに見つけられていないのか、開いていないのかを切り分ける)
  const added: HTMLElement[] = [];
  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of Array.from(rec.addedNodes)) {
        if (node instanceof HTMLElement && node.id !== "lastclick-pigeon-banner") added.push(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  btn.focus();
  log.push(`focus→${document.activeElement === btn ? "ボタン" : describe((document.activeElement as HTMLElement | null) ?? document.body)}`);
  const press = safePress(target, "setThumbnail.addButton", at);
  let hit = await appeared(500);
  log.push(`pointer→${hit ? "出た" : "なし"}`);
  press.release({ click: !hit });
  if (!hit) {
    hit = await appeared(1_000);
    log.push(`click→${hit ? "出た" : "なし"}`);
  }
  for (const key of ["Enter", " "] as const) {
    if (hit) break;
    safeKey(btn, "setThumbnail.addButton", key);
    hit = await appeared(1_000);
    log.push(`${key === " " ? "Space" : key}→${hit ? "出た" : "なし"}`);
  }
  observer.disconnect();
  if (guard.input()) log.push("ファイル選択ダイアログを止めた");
  const shown = added.filter((el) => el.isConnected).slice(0, 12);
  log.push(shown.length ? `現れた要素(${added.length} 件): ${shown.map((el) => describeShort(el)).join(" | ")}` : "現れた要素: なし");

  let input = fileInput();
  if (!input) {
    const item = menuItem();
    if (item) {
      // 見出し画像のボタンと同じく、実際の操作と同じ順(hover → pointerdown → … → click)で押す
      const ir = item.getBoundingClientRect();
      safePress(item, "setThumbnail.uploadMenu", { x: ir.left + ir.width / 2, y: ir.top + ir.height / 2 }).release({ click: true });
      log.push(`メニュー「${S.thumbnail.uploadMenuText[0]}」を押した`);
      input = await waitUntil(fileInput, 5_000);
    } else {
      log.push(`メニュー「${S.thumbnail.uploadMenuText[0]}」なし`);
    }
  }
  if (!input) {
    // 経過は開発者向けにコンソールへ出し、バナーには短い文だけを出す
    console.warn(`[lastclick-pigeon] 見出し画像: 経過: ${log.join(" / ")}。押したボタン: ${rect(btn)} ${describe(btn)}`);
    throw new Error("画像を選ぶ欄が出ませんでした。画面で入れてください。");
  }
  return input;
}

/** 確定ボタン: 開いているダイアログの中、または `before` に無かった新しいボタンが現れるまで待つ */
export function waitForConfirm(texts: string[], before: Set<HTMLElement>, timeout: number): Promise<HTMLElement | null> {
  const find = () => {
    const dialog = findDialog();
    const inDialog = dialog ? findByText("button", texts, dialog) : null;
    if (inDialog) return inDialog;
    return findAllByText("button", texts).find((b) => !before.has(b)) ?? null;
  };
  return new Promise((resolve) => {
    const found = find();
    if (found) return resolve(found);
    const obs = new MutationObserver(() => {
      const el = find();
      if (el) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => {
      obs.disconnect();
      resolve(null);
    }, timeout);
  });
}
