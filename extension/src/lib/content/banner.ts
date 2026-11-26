// note の編集画面の右下に出す知らせ(バナー)と、工程の結果の記録(content.ts から分けた。動きは変えていない)。
import { type CurrentUser } from "../../../../shared/current-user";

/** 工程を途中で止めるべきときに投げる(後続の工程に進まない)。普通のエラーは記録して次へ進む */
export class StopError extends Error {}

/** 工程を 1 つ実行して結果を記録する。後続に進んでよければ true、StopError なら false */
export async function step(name: string, results: string[], fn: () => Promise<unknown> | unknown): Promise<boolean> {
  // いま何をしているかをバナーに出す(待ちが長いときに、固まったと思わないように)
  bannerStatus(`${name}を入れています…`);
  try {
    const r = await fn();
    results.push(`${name} ✓${typeof r === "string" ? `(${r})` : ""}`);
    return true;
  } catch (e) {
    results.push(`${name} ✗ ${(e as Error).message}`);
    console.warn(`[lastclick-pigeon] ${name}:`, e);
    return !(e instanceof StopError);
  }
}

export type BannerAction = { label: string; onClick: () => Promise<void> | void };

/**
 * 画面右下に進捗を出す。note の DOM を汚さないよう shadow DOM に閉じる。
 * text の 1 行目だけを出し、2 行目以降は「詳細」を押したときに開く(本文の確認の邪魔にならないように)。
 * 「たたむ」で小さなピルにし、押すと戻る。actions を渡すとボタンを出す(押すとボタンを無効にして onClick を呼ぶ。失敗はエラーのバナーにする)
 */
export function banner(text: string, kind: "info" | "ok" | "warn" | "error" = "info", actions: BannerAction[] = [], account: CurrentUser | null = null) {
  let host = document.getElementById("lastclick-pigeon-banner");
  if (!host) {
    host = document.createElement("div");
    host.id = "lastclick-pigeon-banner";
    document.body.appendChild(host);
    host.attachShadow({ mode: "open" });
  }
  const colors = { info: "#2d6cdf", ok: "#1f9d7a", warn: "#c27c0e", error: "#c0392b" };
  // 空行(\n\n)より前が常に見える部分(複数行でもよい)、後ろが「詳細」で開く部分
  const sep = text.indexOf("\n\n");
  const summary = sep < 0 ? text : text.slice(0, sep);
  const details = sep < 0 ? "" : text.slice(sep + 2).trim();
  // 文字リンク風のボタン(キーボードでも操作できるように button にする)
  const link = `border:0;padding:0;background:none;color:#fff;cursor:pointer;opacity:.85;font:13px system-ui,sans-serif;text-decoration:underline;text-underline-offset:3px`;
  const buttons = actions
    .map(
      (a, i) =>
        `<button type="button" data-action="${i}" style="padding:6px 12px;border:0;border-radius:6px;
          background:#fff;color:${colors[kind]};font:600 13px system-ui,sans-serif;cursor:pointer">${escapeHtml(a.label)}</button>`,
    )
    .join("");
  // 進めているあいだ(ボタンの無いお知らせ)は、くるくる回る印を出す(止まっていないことが分かるように)
  const working = kind === "info" && actions.length === 0;
  // 進めているあいだは、操作を控えてもらう。拡張が文字を選んで画像を貼ったり、目印を消したりしている途中に
  // 文字を打ったりクリックしたりすると、目印が残ったり、違う場所に入ったりする。note のダイアログ(OK を押すもの)だけは押してもらう
  // (この関数は main() から最初の await より前に呼ばれるので、文はファイルの先頭の const にせず、ここに置く)
  // バナーの見出し。どのサイト向けの知らせかが分かるように、入れる先を添える(waitNotice と同じ理由で、ここに置く)
  const BANNER_TITLE = "Last One Click for note";
  const waitNotice = "処理中です。終わるまで、note の編集画面は操作せずにお待ちください(note のダイアログが出たときは「OK」を押してください)";
  const spin = (size: number) =>
    working
      ? `<span class="spin" aria-hidden="true" style="display:inline-block;width:${size}px;height:${size}px;margin-right:6px;vertical-align:-1px;
          border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:loc-spin .9s linear infinite"></span>`
      : "";
  host.shadowRoot!.innerHTML = `
    <style>@keyframes loc-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.spin{animation-duration:3s}}</style>
    <div id="box" style="position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:440px;padding:12px 16px;
      border-radius:10px;background:${colors[kind]};color:#fff;font:14px/1.6 system-ui,sans-serif;
      box-shadow:0 4px 16px rgba(0,0,0,.25)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px"><b>${spin(12)}${BANNER_TITLE}</b><button type="button" id="min" aria-label="バナーをたたむ" style="${link}">たたむ</button></div>
      ${working ? `<div id="wait" style="margin-bottom:6px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,.18);font-size:13px">${escapeHtml(waitNotice)}</div>` : ""}
      <div id="sum" style="white-space:pre-wrap">${escapeHtml(summary ?? "")}</div>
      ${account ? `<div id="account" style="margin-top:6px;display:flex;align-items:center;gap:6px;font-size:13px"></div>` : ""}
      ${details ? `<div id="det" hidden style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.3);font-size:13px;opacity:.95;white-space:pre-wrap">${escapeHtml(details)}</div>` : ""}
      <div style="margin-top:10px;display:flex;align-items:center;justify-content:flex-end;gap:12px">${details ? `<button type="button" id="tog" aria-expanded="false" aria-controls="det" style="${link}">詳細</button>` : ""}${buttons}</div>
    </div>
    <button type="button" id="pill" hidden aria-label="${BANNER_TITLE} のバナーを開く" style="position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:6px 12px;border:0;border-radius:999px;
      background:${colors[kind]};color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25)">${spin(10)}${BANNER_TITLE} ▴</button>`;
  const root = host.shadowRoot!;
  const accountEl = root.getElementById("account");
  if (account && accountEl) accountEl.append(...accountNodes("作成に使った note のアカウント:", account));
  const box = root.getElementById("box")!;
  const pill = root.getElementById("pill")!;
  root.getElementById("min")!.onclick = () => {
    box.hidden = true;
    pill.hidden = false;
    pill.focus();
  };
  pill.onclick = () => {
    pill.hidden = true;
    box.hidden = false;
    root.getElementById("min")!.focus();
  };
  const tog = root.getElementById("tog");
  const det = root.getElementById("det");
  if (tog && det) {
    tog.onclick = () => {
      det.hidden = !det.hidden;
      tog.textContent = det.hidden ? "詳細" : "詳細を閉じる";
      tog.setAttribute("aria-expanded", String(!det.hidden));
    };
  }
  root.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((b) => {
    b.onclick = () => {
      root.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((x) => (x.disabled = true));
      Promise.resolve(actions[Number(b.dataset.action)]!.onClick()).catch((e) => banner(`エラー: ${(e as Error).message}`, "error"));
    };
  });
}

/**
 * 進めているあいだのお知らせの文だけを書き換える(バナーを作り直さないので、「たたむ」で小さくしたままにできる)。
 * 進めている途中のバナーが無いとき(ボタンや結果を出しているときなど)は、新しく出す
 */
export function bannerStatus(text: string) {
  const root = document.getElementById("lastclick-pigeon-banner")?.shadowRoot;
  const sum = root?.getElementById("sum");
  if (sum && root?.querySelector(".spin")) sum.textContent = text;
  else banner(text);
}

/**
 * 「<見出し> [アイコン] 名前 (@ID)」を作る。文字は textContent で入れる(HTML として読まない)。
 * アイコンは応答にある https の URL をそのまま img で出すだけ(取り込んで保存しない)
 */
export function accountNodes(heading: string, account: CurrentUser): Node[] {
  const nodes: Node[] = [document.createTextNode(heading)];
  if (account.iconUrl) {
    const img = document.createElement("img");
    img.src = account.iconUrl;
    img.alt = "";
    img.width = 20;
    img.height = 20;
    img.referrerPolicy = "no-referrer";
    img.style.cssText = "border-radius:50%;background:#fff;flex:none";
    nodes.push(img);
  }
  const name = document.createElement("b");
  name.textContent = account.name;
  nodes.push(name);
  if (account.id && account.id !== account.name) nodes.push(document.createTextNode(`(@${account.id})`));
  return nodes;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
