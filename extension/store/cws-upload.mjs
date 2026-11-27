// Chrome ウェブストアに、新しい版の ZIP をアップロードする(Chrome Web Store API v2。#134)。
// .github/workflows/release.yml(「リリースを作る」)の、ストアにアップロードするジョブから使う。
//   (Actions の中)CWS_WIF_PROVIDER=… CWS_SERVICE_ACCOUNT=… CWS_PUBLISHER_ID=… node store/cws-upload.mjs <ZIP> <版>
//   (手元で試すとき)CWS_ACCESS_TOKEN=… CWS_PUBLISHER_ID=… node store/cws-upload.mjs <ZIP> <版>
// - アップロードだけをする。「審査のため送信」(publish)は人が押す。publish・cancelSubmission などの書き込みの API は呼ばない
// - 前の版が審査中なら、上げずに止める(読むだけの fetchStatus で確かめる)
// - 説明文・画像・プライバシーの回答は、申請用のツール(#215)か、人がダッシュボードで入れる
// - Google には、GitHub の OIDC のトークンから入る(Workload Identity 連携。外の Action は使わない。#216)。
//   もらったトークンは ::add-mask:: でログから伏せる。エラーの文にも出さない
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const API = "https://chromewebstore.googleapis.com";
export const STS_URL = "https://sts.googleapis.com/v1/token";
export const IAM_CREDENTIALS = "https://iamcredentials.googleapis.com/v1";
export const CWS_SCOPE = "https://www.googleapis.com/auth/chromewebstore";
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

/** API のエラーの文。トークンの形の文字(Google のアクセストークン・JWT)は伏せる */
async function failure(res, what) {
  const text = (await res.text().catch(() => ""))
    .replace(/ya29\.[\w.-]+/g, "***")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "***");
  return new Error(`${what}: HTTP ${res.status} ${text.slice(0, 2000)}`);
}

/**
 * GitHub の OIDC のトークンから、サービスアカウントのアクセストークン(ストアのスコープだけ)を作る(Workload Identity 連携)。
 * 1. GitHub から OIDC のトークンをもらう(オーディエンスは Workload Identity プロバイダ)
 * 2. Google の STS で、Google のトークンに交換する
 * 3. IAM Credentials で、サービスアカウントのアクセストークンを作る(短い期限)
 * もらったトークンは mask(::add-mask::)でログから伏せる
 */
export async function accessTokenFromGitHub({ requestUrl, requestToken, provider, serviceAccount, fetch = globalThis.fetch, mask = (v) => console.log(`::add-mask::${v}`) }) {
  if (!requestUrl || !requestToken) throw new Error("GitHub の OIDC のトークンをもらえません(ジョブに id-token: write の権限がありますか)");
  if (!provider) throw new Error("Workload Identity プロバイダ(CWS_WIF_PROVIDER)がありません");
  if (!serviceAccount) throw new Error("サービスアカウント(CWS_SERVICE_ACCOUNT)がありません");
  const audience = `//iam.googleapis.com/${provider}`;

  // 1. GitHub の OIDC のトークン
  const url = new URL(requestUrl);
  url.searchParams.set("audience", `https:${audience}`);
  const oidcRes = await fetch(url.toString(), { headers: { authorization: `bearer ${requestToken}` } });
  if (!oidcRes.ok) throw await failure(oidcRes, "GitHub の OIDC のトークンをもらえませんでした");
  const oidc = (await oidcRes.json()).value;
  if (!oidc) throw new Error("GitHub の OIDC のトークンをもらえませんでした(応答に value がありません)");
  mask(oidc);

  // 2. STS で Google のトークンに交換する
  const stsRes = await fetch(STS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      audience,
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      scope: "https://www.googleapis.com/auth/cloud-platform",
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      subjectToken: oidc,
    }),
  });
  if (!stsRes.ok) throw await failure(stsRes, "Google に入れませんでした(Workload Identity 連携の設定・属性条件を確かめてください)");
  const federated = (await stsRes.json()).access_token;
  if (!federated) throw new Error("Google に入れませんでした(応答に access_token がありません)");
  mask(federated);

  // 3. サービスアカウントのアクセストークンを作る
  const genRes = await fetch(`${IAM_CREDENTIALS}/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:generateAccessToken`, {
    method: "POST",
    headers: { authorization: `Bearer ${federated}`, "content-type": "application/json" },
    body: JSON.stringify({ scope: [CWS_SCOPE], lifetime: "600s" }),
  });
  if (!genRes.ok) throw await failure(genRes, "サービスアカウントのトークンを作れませんでした(サービスアカウントの権限を確かめてください)");
  const token = (await genRes.json()).accessToken;
  if (!token) throw new Error("サービスアカウントのトークンを作れませんでした(応答に accessToken がありません)");
  mask(token);
  return token;
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
    console.error("使い方: CWS_WIF_PROVIDER=… CWS_SERVICE_ACCOUNT=… CWS_PUBLISHER_ID=… node store/cws-upload.mjs <ZIP> <版>");
    process.exit(2);
  }
  const env = process.env;
  (async () => {
    // 手元で試すときは CWS_ACCESS_TOKEN を渡せる。Actions の中では GitHub の OIDC から作る
    const accessToken =
      env.CWS_ACCESS_TOKEN ||
      (await accessTokenFromGitHub({
        requestUrl: env.ACTIONS_ID_TOKEN_REQUEST_URL,
        requestToken: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
        provider: env.CWS_WIF_PROVIDER,
        serviceAccount: env.CWS_SERVICE_ACCOUNT,
      }));
    await upload({ zip: readFileSync(zipPath), version, accessToken, publisherId: env.CWS_PUBLISHER_ID, itemId: env.CWS_ITEM_ID || DEFAULT_ITEM_ID });
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
