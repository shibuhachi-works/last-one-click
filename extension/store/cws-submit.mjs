// Chrome ウェブストアに、新しい版の ZIP を上げて審査に出す(Chrome Web Store API v2)。
// .github/workflows/store-submit.yml(「ストアに申請する」。人が起動する)から使う。
//   node store/cws-submit.mjs <ZIP> <版> <STAGED_PUBLISH|DEFAULT_PUBLISH>
// - 掲載文・画像・プライバシーの回答は API では変えられない(人がダッシュボードで直す)
// - STAGED_PUBLISH: 審査に通ったら止めておき、人がダッシュボードで公開する。DEFAULT_PUBLISH: 通ったらすぐ公開
// - 鍵(OAuth のクライアント ID・シークレット・リフレッシュトークン)と公開者 ID は環境変数で受け取る。値は表示しない
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const API = "https://chromewebstore.googleapis.com";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** ストアのアイテム ID(ストアの URL の末尾。公開されている値) */
export const DEFAULT_ITEM_ID = "jomapffkhcdpnodaffobmpfofnnaihnd";
export const PUBLISH_TYPES = ["STAGED_PUBLISH", "DEFAULT_PUBLISH"];
/** 審査に出したあと、問題がないとみる状態(審査中・止めて待つ・公開済み) */
const OK_STATES = ["PENDING_REVIEW", "STAGED", "PUBLISHED"];

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

/** 審査に出した結果の状態を見る。問題がなければその状態を返し、だめなら Error を投げる */
export function checkPublish(state) {
  if (!OK_STATES.includes(state)) throw new Error(`審査に出せませんでした(${state ?? "なし"})`);
  return state;
}

/** API のエラーの文。応答の本文には鍵は入らない(入っても出さないよう、トークンの形の文字は伏せる) */
async function failure(res, what) {
  const text = (await res.text().catch(() => "")).replace(/ya29\.[\w.-]+/g, "***");
  return new Error(`${what}: HTTP ${res.status} ${text.slice(0, 2000)}`);
}

/**
 * ZIP を上げて審査に出す。fetch と sleep は差し替えられる(テストのため)。
 * 戻り値は審査に出したあとの状態(PENDING_REVIEW など)と、出たときの注意
 */
export async function submit({ zip, version, publishType, clientId, clientSecret, refreshToken, publisherId, itemId = DEFAULT_ITEM_ID, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log, pollMs = 5_000, pollMax = 60 }) {
  if (!PUBLISH_TYPES.includes(publishType)) throw new Error(`公開のしかたは ${PUBLISH_TYPES.join(" か ")}: ${publishType}`);
  for (const [name, v] of Object.entries({ CWS_CLIENT_ID: clientId, CWS_CLIENT_SECRET: clientSecret, CWS_REFRESH_TOKEN: refreshToken, CWS_PUBLISHER_ID: publisherId })) {
    if (!v) throw new Error(`${name} がありません(リポジトリの Secrets に入れてください。手順は docs/store-submission.md)`);
  }
  const path = itemPath(publisherId, itemId);

  // 1. アクセストークンをもらう
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }).toString(),
  });
  if (!tokenRes.ok) throw await failure(tokenRes, "アクセストークンをもらえませんでした");
  const { access_token: token } = await tokenRes.json();
  if (!token) throw new Error("アクセストークンをもらえませんでした(応答に access_token がありません)");
  const auth = { authorization: `Bearer ${token}` };

  // 2. ZIP を上げる
  log(`ZIP を上げます: ${itemId}(版 ${version})`);
  const upRes = await fetch(`${API}/upload/v2/${path}:upload`, { method: "POST", headers: { ...auth, "content-type": "application/zip" }, body: zip });
  if (!upRes.ok) throw await failure(upRes, "ZIP を上げられませんでした");
  const up = await upRes.json();
  let done = checkUpload(up.uploadState, up.crxVersion, version).done;
  // 3. 上げ終わるまで待つ
  for (let i = 0; !done && i < pollMax; i++) {
    await sleep(pollMs);
    const stRes = await fetch(`${API}/v2/${path}:fetchStatus`, { headers: auth });
    if (!stRes.ok) throw await failure(stRes, "状態を読めませんでした");
    const st = await stRes.json();
    done = checkUpload(st.lastAsyncUploadState, undefined, version).done;
  }
  if (!done) throw new Error("ZIP を上げ終わるのを待ちきれませんでした(ダッシュボードで確かめてください)");
  log("ZIP を上げました");

  // 4. 審査に出す
  const pubRes = await fetch(`${API}/v2/${path}:publish`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ publishType }),
  });
  if (!pubRes.ok) throw await failure(pubRes, "審査に出せませんでした");
  const pub = await pubRes.json();
  const warnings = (pub.warningInfo?.warnings ?? []).map((w) => `${w.reason ?? ""} ${w.description ?? ""}`.trim());
  for (const w of warnings) log(`注意: ${w}`);
  const state = checkPublish(pub.state);
  log(`審査に出しました: ${state}(${publishType === "STAGED_PUBLISH" ? "通ったら止めておきます。ダッシュボードで公開してください" : "通ったらすぐ公開されます"})`);
  return { state, warnings };
}

// コマンドとして動かしたときだけ、引数と環境変数で申請する
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [zipPath, version, publishType] = process.argv.slice(2);
  if (!zipPath || !version || !publishType) {
    console.error("使い方: node store/cws-submit.mjs <ZIP> <版> <STAGED_PUBLISH|DEFAULT_PUBLISH>");
    process.exit(2);
  }
  submit({
    zip: readFileSync(zipPath),
    version,
    publishType,
    clientId: process.env.CWS_CLIENT_ID,
    clientSecret: process.env.CWS_CLIENT_SECRET,
    refreshToken: process.env.CWS_REFRESH_TOKEN,
    publisherId: process.env.CWS_PUBLISHER_ID,
    itemId: process.env.CWS_ITEM_ID || DEFAULT_ITEM_ID,
  }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
