// Chrome ウェブストアへのアップロード(extension/store/cws-upload.mjs。#134)を、API の応答を差し替えて確かめる。本物の API には繋がない
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
// @ts-expect-error 型の無い .mjs
import { accessTokenFromGitHub, checkUpload, pendingReview, upload, DEFAULT_ITEM_ID } from "../extension/store/cws-upload.mjs";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** 決めた順に応答を返す fetch。呼ばれた中身を calls に残す */
function fakeFetch(responses: { status?: number; json?: unknown; text?: string }[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
    const r = responses.shift();
    if (!r) throw new Error(`思っていない呼び出し: ${url}`);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.json, text: async () => r.text ?? JSON.stringify(r.json ?? {}) };
  };
  return { fetch, calls };
}

const base = { zip: Buffer.from("zip"), version: "0.2.0", accessToken: "ya29.secret", publisherId: "pub1", log: () => {}, sleep: async () => {} };
const item = `https://chromewebstore.googleapis.com/v2/publishers/pub1/items/${DEFAULT_ITEM_ID}`;
const PUBLISHED = { json: { submittedItemRevisionStatus: { state: "PUBLISHED" } } };

describe("checkUpload / pendingReview", () => {
  it("上げ終わり・途中・失敗・版の違いを見分ける", () => {
    assert.deepEqual(checkUpload("SUCCEEDED", "0.2.0", "0.2.0"), { done: true });
    assert.deepEqual(checkUpload("IN_PROGRESS", undefined, "0.2.0"), { done: false });
    assert.deepEqual(checkUpload("UPLOAD_IN_PROGRESS", undefined, "0.2.0"), { done: false });
    assert.throws(() => checkUpload("FAILED", undefined, "0.2.0"), /上げられませんでした/);
    assert.throws(() => checkUpload("SUCCEEDED", "0.1.8", "0.2.0"), /0\.1\.8.*0\.2\.0/);
  });
  it("審査中だけを見分ける", () => {
    assert.equal(pendingReview({ submittedItemRevisionStatus: { state: "PENDING_REVIEW" } }), true);
    for (const s of ["PUBLISHED", "STAGED", "REJECTED", undefined]) assert.equal(pendingReview({ submittedItemRevisionStatus: { state: s } }), false);
    assert.equal(pendingReview({}), false);
  });
});

describe("upload", () => {
  it("状態を読み、ZIP を上げる。publish は呼ばない", async () => {
    const { fetch, calls } = fakeFetch([PUBLISHED, { json: { uploadState: "SUCCEEDED", crxVersion: "0.2.0" } }]);
    await upload({ ...base, fetch });
    assert.equal(calls[0]!.url, `${item}:fetchStatus`);
    assert.equal(calls[1]!.url, `https://chromewebstore.googleapis.com/upload/v2/publishers/pub1/items/${DEFAULT_ITEM_ID}:upload`);
    assert.equal(calls[1]!.headers.authorization, "Bearer ya29.secret");
    assert.ok(!calls.some((c) => /:publish|:cancelSubmission|:rollback|:setPublished/.test(c.url)));
  });

  it("前の版が審査中なら、上げずに止める", async () => {
    const { fetch, calls } = fakeFetch([{ json: { submittedItemRevisionStatus: { state: "PENDING_REVIEW" } } }]);
    await assert.rejects(upload({ ...base, fetch }), /審査中/);
    assert.equal(calls.length, 1);
  });

  it("上げるのに時間がかかれば、状態を読んで終わるまで待つ", async () => {
    const { fetch, calls } = fakeFetch([
      PUBLISHED,
      { json: { uploadState: "IN_PROGRESS" } },
      { json: { lastAsyncUploadState: "IN_PROGRESS" } },
      { json: { lastAsyncUploadState: "SUCCEEDED" } },
    ]);
    await upload({ ...base, fetch });
    assert.equal(calls.filter((c) => c.url.endsWith(":fetchStatus")).length, 3);
  });

  it("上がった版が違えば失敗にする", async () => {
    const { fetch } = fakeFetch([PUBLISHED, { json: { uploadState: "SUCCEEDED", crxVersion: "0.1.8" } }]);
    await assert.rejects(upload({ ...base, fetch }), /0\.1\.8/);
  });

  it("API が失敗したら止まり、エラーの文にトークンを出さない", async () => {
    const { fetch } = fakeFetch([PUBLISHED, { status: 400, text: '{"error":{"message":"bad ya29.secret"}}' }]);
    await assert.rejects(upload({ ...base, fetch }), (e: Error) => {
      assert.match(e.message, /HTTP 400/);
      assert.doesNotMatch(e.message, /ya29\.secret/);
      return true;
    });
  });

  it("トークンか公開者 ID が無ければ、どこにも繋がずに止まる", async () => {
    const { fetch, calls } = fakeFetch([]);
    await assert.rejects(upload({ ...base, accessToken: "", fetch }), /アクセストークン/);
    await assert.rejects(upload({ ...base, publisherId: "", fetch }), /CWS_PUBLISHER_ID/);
    assert.equal(calls.length, 0);
  });

  it("スクリプトに、ほかの書き込みの API の名前を書かない", () => {
    const src = readFileSync(new URL("../extension/store/cws-upload.mjs", import.meta.url), "utf8");
    // コメントの「publish・cancelSubmission などは呼ばない」の説明は除いて、呼び出しの形だけを見る
    assert.doesNotMatch(src, /:(publish|cancelSubmission|rollback|setPublishedDeployPercentage)`/);
  });
});

describe("accessTokenFromGitHub", () => {
  const provider = "projects/123/locations/global/workloadIdentityPools/github/providers/github-actions";
  const args = { requestUrl: "https://gh.example/token?api-version=2.0", requestToken: "req", provider, serviceAccount: "sa@p.iam.gserviceaccount.com" };

  it("GitHub の OIDC → STS → サービスアカウントのトークン、の順に作り、どれも伏せる", async () => {
    const { fetch, calls } = fakeFetch([
      { json: { value: "eyJa.b.c" } },
      { json: { access_token: "ya29.federated" } },
      { json: { accessToken: "ya29.sa" } },
    ]);
    const masked: string[] = [];
    const token = await accessTokenFromGitHub({ ...args, fetch, mask: (v: string) => masked.push(v) });
    assert.equal(token, "ya29.sa");
    assert.deepEqual(masked, ["eyJa.b.c", "ya29.federated", "ya29.sa"]);
    // 1. オーディエンスはプロバイダ。既にある問い合わせ(api-version)は残す
    const u = new URL(calls[0]!.url);
    assert.equal(u.searchParams.get("audience"), `https://iam.googleapis.com/${provider}`);
    assert.equal(u.searchParams.get("api-version"), "2.0");
    assert.equal(calls[0]!.headers.authorization, "bearer req");
    // 2. STS
    assert.equal(calls[1]!.url, "https://sts.googleapis.com/v1/token");
    const sts = JSON.parse(String(calls[1]!.body));
    assert.equal(sts.audience, `//iam.googleapis.com/${provider}`);
    assert.equal(sts.subjectToken, "eyJa.b.c");
    assert.equal(sts.subjectTokenType, "urn:ietf:params:oauth:token-type:jwt");
    // 3. サービスアカウントのトークン。スコープはストアだけ、期限は短い
    assert.equal(calls[2]!.url, "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/sa%40p.iam.gserviceaccount.com:generateAccessToken");
    assert.equal(calls[2]!.headers.authorization, "Bearer ya29.federated");
    assert.deepEqual(JSON.parse(String(calls[2]!.body)), { scope: ["https://www.googleapis.com/auth/chromewebstore"], lifetime: "600s" });
  });

  it("id-token の権限が無い・設定が足りないときは、どこにも繋がずに止まる", async () => {
    const { fetch, calls } = fakeFetch([]);
    await assert.rejects(accessTokenFromGitHub({ ...args, requestUrl: undefined, fetch, mask: () => {} }), /id-token/);
    await assert.rejects(accessTokenFromGitHub({ ...args, provider: "", fetch, mask: () => {} }), /CWS_WIF_PROVIDER/);
    await assert.rejects(accessTokenFromGitHub({ ...args, serviceAccount: "", fetch, mask: () => {} }), /CWS_SERVICE_ACCOUNT/);
    assert.equal(calls.length, 0);
  });

  it("STS が断ったら止まり、エラーの文にトークンを出さない", async () => {
    const { fetch } = fakeFetch([
      { json: { value: "eyJhead.body.sig" } },
      { status: 400, text: '{"error":"unauthorized_client","detail":"eyJhead.body.sig"}' },
    ]);
    await assert.rejects(accessTokenFromGitHub({ ...args, fetch, mask: () => {} }), (e: Error) => {
      assert.match(e.message, /HTTP 400/);
      assert.match(e.message, /属性条件/);
      assert.doesNotMatch(e.message, /eyJhead/);
      return true;
    });
  });
});

