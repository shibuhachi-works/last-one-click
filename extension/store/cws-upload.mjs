// Chrome ウェブストアに、新しい版の ZIP をアップロードする(Chrome Web Store API v2。#134)。
// .github/workflows/release.yml(「リリースを作る」)の、ストアにアップロードするジョブから使う。
//   CWS_ACCESS_TOKEN=… CWS_PUBLISHER_ID=… node store/cws-upload.mjs <ZIP> <版>
// - アップロードだけをする。「審査のため送信」(publish)は人が押す。publish・cancelSubmission などの書き込みの API は呼ばない
// - 前の版が審査中なら、上げずに止める(読むだけの fetchStatus で確かめる)
// - 説明文・画像・プライバシーの回答は、申請用のツール(#215)か、人がダッシュボードで入れる
// - アクセストークンは環境変数で受け取る(workflow が Google に入って作る)。値は表示しない
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const API = "https://chromewebstore.googleapis.com";
/** ストアのアイテム ID(ストアの URL の末尾。公開されている値) */
export const DEFAULT_ITEM_ID = "jomapffkhcdpnodaffobmpfofnnaihnd";

export const itemPath = (publisherId, itemId) => `publishers/${publisherId}/items/${itemId}`;

/**
 * 上げた結果を見る。終わっていれば { done: true }、まだなら { done: false }、失敗なら Error を投げる。
 * 版が分かれば、上がった版が思った版かも確かめる(古い ZIP を上げていないか)
 */
export function checkUpload(state, crxVersion, version) {
  if (state === "FAILED" || state === "NOT_FOUND") throw new Error(`ZIP を上げられませんでした(${state})`);
  if (state === "IN_PROGRESS" || state === "UPLOAD_IN_PROGRESS") return { done: false };
  if (state !== "SUCCEEDED") throw new Error(`上げた結果が分かりません(${state ?? "なし"})`);
  if (crxVersion && crxVersion !== version) throw new Error(`上がった版(${crxVersion})が、上げたい版(${version})と違います`);
  return { done: true };
}

/** 審査に出している版があるか(あれば、新しい ZIP を上げない) */
export function pendingReview(status) {
  return status?.submittedItemRevisionStatus?.state === "PENDING_REVIEW";
}

/** API のエラーの文。トークンの形の文字は伏せる */
async function failure(res, what) {
  const text = (await res.text().catch(() => "")).replace(/ya29\.[\w.-]+/g, "***");
  return new Error(`${what}: HTTP ${res.status} ${text.slice(0, 2000)}`);
}

/**
 * ZIP を上げる。fetch と sleep は差し替えられる(テストのため)
 */
export async function upload({ zip, version, accessToken, publisherId, itemId = DEFAULT_ITEM_ID, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log, pollMs = 5_000, pollMax = 60 }) {
  if (!accessToken) throw new Error("アクセストークンがありません");
  if (!publisherId) throw new Error("公開者 ID(CWS_PUBLISHER_ID)がありません");
  const path = itemPath(publisherId, itemId);
  const auth = { authorization: `Bearer ${accessToken}` };
  const readStatus = async () => {
    const res = await fetch(`${API}/v2/${path}:fetchStatus`, { headers: auth });
    if (!res.ok) throw await failure(res, "ストアの状態を読めませんでした");
    return res.json();
  };

  // 1. 前の版が審査中なら止める(審査中の版を差し替えないため。取り消しは人がダッシュボードで行う)
  if (pendingReview(await readStatus())) {
    throw new Error("前の版が審査中なので、上げませんでした。公開されてから、upload_only でアップロードだけやり直してください");
  }

  // 2. ZIP を上げる
  log(`ZIP を上げます: ${itemId}(版 ${version})`);
  const upRes = await fetch(`${API}/upload/v2/${path}:upload`, { method: "POST", headers: { ...auth, "content-type": "application/zip" }, body: zip });
  if (!upRes.ok) throw await failure(upRes, "ZIP を上げられませんでした");
  const up = await upRes.json();
  let done = checkUpload(up.uploadState, up.crxVersion, version).done;

  // 3. 上げ終わるまで待つ
  for (let i = 0; !done && i < pollMax; i++) {
    await sleep(pollMs);
    done = checkUpload((await readStatus()).lastAsyncUploadState, undefined, version).done;
  }
  if (!done) throw new Error("ZIP を上げ終わるのを待ちきれませんでした(ダッシュボードで確かめてください)");
  log("ZIP を上げました。説明文・画像・プライバシーの回答を確かめ、保存してから「審査のため送信」を押してください");
}

// コマンドとして動かしたときだけ、引数と環境変数で上げる
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [zipPath, version] = process.argv.slice(2);
  if (!zipPath || !version) {
    console.error("使い方: CWS_ACCESS_TOKEN=… CWS_PUBLISHER_ID=… node store/cws-upload.mjs <ZIP> <版>");
    process.exit(2);
  }
  upload({
    zip: readFileSync(zipPath),
    version,
    accessToken: process.env.CWS_ACCESS_TOKEN,
    publisherId: process.env.CWS_PUBLISHER_ID,
    itemId: process.env.CWS_ITEM_ID || DEFAULT_ITEM_ID,
  }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
