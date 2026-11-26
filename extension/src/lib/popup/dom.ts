// ポップアップの画面の小さな道具: 要素を ID で取る・知らせを出す・アカウントの 1 行(popup.ts から分けた。動きは変えていない)。

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * 知らせを出す場所。押したボタン(操作した所)のすぐそばに出す(#141)。
 * 「note の下書きを作成」の知らせは、今までどおり #status(ボタンのすぐ下)
 */
export const STATUS_IDS = {
  submit: "status",
  window: "status-window",
  drop: "status-drop",
  github: "status-github",
  diagnose: "status-diagnose",
  settings: "status-settings",
  selectors: "status-selectors",
  advanced: "status-advanced",
  extraSiteOffer: "status-extra-site-offer",
  extraSiteToggle: "status-extra-site-toggle",
} as const;

export type StatusPlace = keyof typeof STATUS_IDS;

/** 知らせを near の場所に出す。同時に出すのは 1 か所だけ(前の知らせは消す) */
export function setStatus(msg: string, { error = false, near }: { error?: boolean; near: StatusPlace }) {
  for (const [place, id] of Object.entries(STATUS_IDS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (place !== near) {
      el.hidden = true;
      el.textContent = "";
      el.removeAttribute("role");
      continue;
    }
    el.hidden = false;
    // 読み上げにも届くように、エラーは alert、それ以外は status
    el.setAttribute("role", error ? "alert" : "status");
    // 可読性のため、一文ごとに改行して出す(CSS の white-space: pre-line で改行を効かせる)
    el.textContent = msg.replace(/。(?=.)/g, "。\n");
    el.classList.toggle("error", error);
  }
}

/** アカウントの 1 行の中身: 「(ドメイン):」と、[アイコン] 名前 (@ID)。アイコンは https のときだけ */
export function accountRow(host: string, iconUrl: unknown, name?: string, suffix?: string): Node[] {
  const label = document.createElement("span");
  label.className = "host";
  label.textContent = `${host}:`;
  const who = document.createElement("span");
  who.className = "who";
  if (typeof iconUrl === "string" && iconUrl.startsWith("https://")) {
    const img = document.createElement("img");
    img.src = iconUrl;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    who.append(img);
  }
  if (name) {
    const b = document.createElement("b");
    b.textContent = name;
    who.append(b);
  }
  if (suffix) who.append(document.createTextNode(suffix));
  return [label, who];
}
