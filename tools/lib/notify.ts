// 通知。見張り役(tools/watch.ts)と、待つモード(tools/draft.ts --hold)が使う。
// (1) デスクトップの通知: Linux は notify-send(libnotify-bin)、Mac は通知センター。無ければ何もしない
// (2) Webhook: 環境変数 LOC_WATCH_WEBHOOK_URL があれば、その URL に JSON を POST する。
//     本文は {"text": ..., "content": ...}(同じ文)。text は Slack の Incoming Webhook、content は Discord の Webhook が読む。
//     URL は合い言葉と同じ(知られると誰でも送れる)なので、ファイルに書かず、キーリングから渡す(tools/linux/watch.sh)
// (3) リモートデスクトップのリンク: 環境変数 LOC_WATCH_REMOTE_URL(rdp:// か https://)があれば、
//     「公開の手前で待っています」の Webhook の文の最後に付ける(スマホからそのまま開けるように)
import { spawnSync } from "node:child_process";

export async function notify(title: string, body: string, opts: { remote?: boolean } = {}): Promise<void> {
  if (process.platform === "linux") {
    spawnSync("notify-send", ["--app-name=Last One Click", `Last One Click: ${title}`, body]);
  } else if (process.platform === "darwin") {
    const q = (t: string) => `"${t.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
    spawnSync("osascript", ["-e", `display notification ${q(body)} with title ${q("Last One Click")} subtitle ${q(title)}`]);
  }
  const remote = opts.remote ? remoteUrl(process.env.LOC_WATCH_REMOTE_URL) : undefined;
  await postWebhook(`Last One Click: ${title}\n${body}${remote ? `\nリモートデスクトップ: ${remote}` : ""}`);
}

/** リモートデスクトップのリンクとして使ってよいか(rdp:// か https:// だけ。それ以外は付けない) */
export function remoteUrl(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  if (/^rdp:\/\/[^\s<>|]+$/i.test(t)) return t;
  try {
    const u = new URL(t);
    return u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Webhook の URL として使ってよいか(https だけ。URL の中身はログに出さない) */
export function webhookUrl(raw: string | undefined): URL | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" ? u : undefined;
  } catch {
    return undefined;
  }
}

async function postWebhook(text: string): Promise<void> {
  const raw = process.env.LOC_WATCH_WEBHOOK_URL;
  if (!raw) return;
  const url = webhookUrl(raw);
  if (!url) {
    console.error("LOC_WATCH_WEBHOOK_URL は https の URL にしてください(通知は送りませんでした)。");
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(10_000),
    });
    // 失敗しても下書きの処理は止めない。URL は秘密なのでログには出さない
    if (!res.ok) console.error(`Webhook への通知に失敗しました(HTTP ${res.status})。`);
  } catch (e) {
    console.error(`Webhook への通知に失敗しました(${(e as Error).name})。`);
  }
}
