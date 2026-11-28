// ツールバーのアイコンを押したタブ(activeTab)で diagnoseDashboard を 1 回動かし、結果をコピーする
import { diagnoseDashboard } from "./diagnose.mjs";

export const DASHBOARD_PREFIXES = ["https://chrome.google.com/webstore/devconsole/", "https://chromewebstore.google.com/devconsole/"];

const msg = document.getElementById("msg");
const out = document.getElementById("out");
document.getElementById("run").addEventListener("click", async () => {
  msg.textContent = "";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !DASHBOARD_PREFIXES.some((p) => tab.url?.startsWith(p))) {
    msg.textContent = "ストアのダッシュボード(デベロッパー コンソール)のタブで押してください。";
    return;
  }
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: diagnoseDashboard });
    const text = String(r?.result ?? "");
    out.hidden = false;
    out.value = text;
    try {
      await navigator.clipboard.writeText(text);
      msg.textContent = `コピーしました(${text.split("\n").length} 行)。セッションに貼ってください。`;
    } catch {
      out.select();
      msg.textContent = "コピーできませんでした。下の欄を全部選んでコピーしてください。";
    }
  } catch (e) {
    msg.textContent = `診断できませんでした: ${e instanceof Error ? e.message : e}`;
  }
});
