// 通知。見張り役(tools/watch.ts)と、待つモード(tools/draft.ts --hold)が使う。
// (1) デスクトップの通知: Linux は notify-send(libnotify-bin)、Mac は通知センター。無ければ何もしない
// (2) Webhook: 環境変数 LOC_WATCH_WEBHOOK_URL があれば、その URL に JSON を POST する。
//     本文は {"text": ..., "content": ...}(同じ文)。text は Slack の Incoming Webhook、content は Discord の Webhook が読む。
//     URL は合い言葉と同じ(知られると誰でも送れる)なので、ファイルに書かず、キーリングから渡す(tools/linux/watch.sh)
// (3) 自分で決めた文: 「下書きが完了しました」の Webhook の文は、環境変数 LOC_WATCH_MESSAGE で変えられる
//     (リモートデスクトップのリンクを入れる、など。書き方は shared/webhook-message.ts)。無ければ既定の文。
//     デスクトップの通知と、ほかの場面(ログインしていない・作れなかった)の文は変わらない
import { spawnSync } from "node:child_process";
import { renderWebhookMessage } from "../../shared/webhook-message.js";

/**
 * opts.done に記事のタイトルを渡すと「下書きが完了した」通知として扱い、Webhook の文を LOC_WATCH_MESSAGE で置き換える
 */
export async function notify(title: string, body: string, opts: { done?: { title: string } } = {}): Promise<void> {
  if (process.platform === "linux") {
    spawnSync("notify-send", ["--app-name=Last One Click", `Last One Click: ${title}`, body]);
  } else if (process.platform === "darwin") {
    const q = (t: string) => `"${t.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
    spawnSync("osascript", ["-e", `display notification ${q(body)} with title ${q("Last One Click")} subtitle ${q(title)}`]);
  }
  const text = `Last One Click: ${title}\n${body}`;
  await postWebhook(opts.done ? renderWebhookMessage(process.env.LOC_WATCH_MESSAGE, { title: opts.done.title, default: text }) : text);
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
