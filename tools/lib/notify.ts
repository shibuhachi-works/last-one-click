// デスクトップの通知。見張り役(tools/watch.ts)と、待つモード(tools/draft.ts --hold)が使う。
import { spawnSync } from "node:child_process";

/**
 * Linux は notify-send(libnotify-bin)、Mac は通知センター。
 * どちらも無ければ何もしない(ログには出ている)。引数はシェルを通さずに渡す
 */
export function notify(title: string, body: string) {
  if (process.platform === "linux") {
    spawnSync("notify-send", ["--app-name=Last One Click", `Last One Click: ${title}`, body]);
  } else if (process.platform === "darwin") {
    const q = (t: string) => `"${t.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
    spawnSync("osascript", ["-e", `display notification ${q(body)} with title ${q("Last One Click")} subtitle ${q(title)}`]);
  }
}
