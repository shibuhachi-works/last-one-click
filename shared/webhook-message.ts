// 「下書きが完了しました」の Webhook(Slack など)に送る文を、自分で決めた文にする(tools/lib/notify.ts が使う)。
// 環境変数 LOC_WATCH_MESSAGE に書く。無いとき・空のときは、いつもの文(既定の文)を送る。
//   {title}    記事のタイトル(保存モードでは、記事のフォルダ名)
//   {default}  既定の文(見出しと本文)
//   \n         改行(.watch.env は 1 行で書くため)

/** 自分で決めた文を組み立てる。決めていなければ既定の文をそのまま返す */
export function renderWebhookMessage(template: string | undefined, vars: { title: string; default: string }): string {
  const t = template?.trim();
  if (!t) return vars.default;
  // 置き換えは 1 回だけ(タイトルの中の {default} などを、もう一度置き換えない)
  return t.replace(/\\n|\{title\}|\{default\}/g, (m) => (m === "\\n" ? "\n" : m === "{title}" ? vars.title : vars.default));
}
