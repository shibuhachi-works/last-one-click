// ストアのダッシュボード(デベロッパー コンソール)の画面の作りを書き出す(#215 の申請用ツールの、最初の一歩)。
// - 読むだけ。入力しない・押さない・送らない
// - 欄に入っている文字は出さない(長さだけ)。メールアドレスの形の文字は伏せる。長い ID の形の URL の区切りも伏せる
// - chrome.scripting.executeScript で関数を文字にして渡すので、この関数の外の変数・関数を使わない
export function diagnoseDashboard() {
  const MAX_TEXT = 80;
  const MAX_ITEMS = 200;
  const clean = (t) =>
    String(t ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<メール>")
      .slice(0, MAX_TEXT);
  // 開いている shadow DOM の中も見る
  const all = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll("*")) {
      all.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const short = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
    return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + cls.map((c) => `.${c}`).join("");
  };
  const path = (el) => {
    const parts = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 4; e = e.parentElement || e.getRootNode()?.host, i++) parts.unshift(short(e));
    return parts.join(" > ");
  };
  const textOfIds = (ids, root) =>
    ids
      .split(/\s+/)
      .map((id) => root.getElementById?.(id)?.textContent ?? document.getElementById(id)?.textContent ?? "")
      .join(" ");
  const labelOf = (el) => {
    const root = el.getRootNode();
    const parts = [];
    if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
    const by = el.getAttribute("aria-labelledby");
    if (by) parts.push(textOfIds(by, root));
    for (const l of el.labels ?? []) parts.push(l.textContent);
    if (!parts.join("").trim()) {
      // 近くの見出し(フォームの枠の中の label・legend など)
      const box = el.closest("fieldset, mat-form-field, [class*='form-field'], label");
      const lab = box?.querySelector("legend, label, mat-label, [class*='label']");
      if (lab && lab !== el) parts.push(lab.textContent);
    }
    if (el.getAttribute("placeholder")) parts.push(`placeholder: ${el.getAttribute("placeholder")}`);
    return clean(parts.join(" / "));
  };

  const lines = [];
  const segs = location.pathname.split("/").map((s) => (s.length >= 20 || /^\d{6,}$/.test(s) ? "<id>" : s));
  lines.push(`# ダッシュボードの診断(${new Date().toISOString().slice(0, 10)})`, "", `- ページ: ${location.host}${segs.join("/")}`);
  lines.push(`- 要素の数: ${all.length}、iframe: ${all.filter((e) => e.tagName === "IFRAME").length}、shadow DOM: ${all.filter((e) => e.shadowRoot).length}`);

  const heads = all.filter((e) => /^H[1-4]$/.test(e.tagName) || e.getAttribute("role") === "heading").filter(visible);
  lines.push("", `## 見出し (${heads.length})`);
  for (const h of heads.slice(0, MAX_ITEMS)) lines.push(`- ${h.tagName.toLowerCase()}: ${clean(h.textContent)}`);

  const fields = all.filter((e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) || e.isContentEditable && e.getAttribute("contenteditable") !== null);
  lines.push("", `## 入力欄 (${fields.length})`);
  fields.slice(0, MAX_ITEMS).forEach((f, i) => {
    const type = f.tagName === "INPUT" ? f.type : f.tagName.toLowerCase();
    const attrs = [
      `type=${type}`,
      f.name ? `name=${f.name}` : "",
      f.getAttribute("formcontrolname") ? `formcontrolname=${f.getAttribute("formcontrolname")}` : "",
      f.maxLength > 0 ? `maxlength=${f.maxLength}` : "",
      f.required ? "required" : "",
      f.disabled ? "disabled" : "",
      type === "file" ? `accept=${f.accept || "(なし)"}${f.multiple ? " multiple" : ""}` : "",
      type === "checkbox" || type === "radio" ? (f.checked ? "checked" : "unchecked") : "",
      type !== "file" && type !== "checkbox" && type !== "radio" ? `value=${"value" in f ? String(f.value).length : (f.textContent ?? "").length} 字` : "",
      visible(f) ? "" : "hidden",
    ].filter(Boolean);
    lines.push(`${i + 1}. 「${labelOf(f)}」 ${attrs.join(" ")}`, `   ${path(f)}`);
  });

  const roles = all.filter((e) => /^(radio|checkbox|switch|combobox|listbox|textbox)$/.test(e.getAttribute("role") ?? "") && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName));
  lines.push("", `## role の付いた欄 (${roles.length})`);
  for (const r of roles.slice(0, MAX_ITEMS))
    lines.push(`- role=${r.getAttribute("role")} 「${labelOf(r) || clean(r.textContent)}」${r.getAttribute("aria-checked") ? ` aria-checked=${r.getAttribute("aria-checked")}` : ""} ${visible(r) ? "" : "hidden"}`.trimEnd(), `  ${path(r)}`);

  const buttons = all.filter((e) => e.tagName === "BUTTON" || e.getAttribute("role") === "button").filter(visible);
  lines.push("", `## ボタン (${buttons.length}。見えているものだけ)`);
  for (const b of buttons.slice(0, MAX_ITEMS))
    lines.push(`- 「${clean(b.getAttribute("aria-label") || b.textContent)}」${b.disabled || b.getAttribute("aria-disabled") === "true" ? " disabled" : ""}`, `  ${path(b)}`);

  const tags = {};
  for (const e of all) if (e.tagName.includes("-")) tags[e.tagName.toLowerCase()] = (tags[e.tagName.toLowerCase()] ?? 0) + 1;
  const top = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 30);
  lines.push("", `## カスタム要素 (${Object.keys(tags).length} 種類。多い順に 30)`, ...top.map(([t, n]) => `- ${t}: ${n}`));
  return lines.join("\n");
}
