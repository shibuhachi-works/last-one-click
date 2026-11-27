// Chrome ウェブストアへの申請(extension/store/cws-submit.mjs)を、API の応答を差し替えて確かめる。本物の API には繋がない
import assert from "node:assert/strict";
import { describe, it } from "node:test";
// @ts-expect-error 型の無い .mjs
import { checkPublish, checkUpload, submit, DEFAULT_ITEM_ID } from "../extension/store/cws-submit.mjs";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** 決めた順に応答を返す fetch。呼ばれた中身を calls に残す */
function fakeFetch(responses: { status?: number; json?: unknown; text?: string }[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
    const r = responses.shift();
    if (!r) throw new Error(`思っていない呼び出し: ${url}`);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.json,
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
    };
  };
  return { fetch, calls };
}

const KEYS = { clientId: "cid", clientSecret: "csecret", refreshToken: "rtoken", publisherId: "pub1" };
const base = { zip: Buffer.from("zip"), version: "0.1.9", log: () => {}, sleep: async () => {}, ...KEYS };

describe("checkUpload / checkPublish", () => {
  it("上げ終わり・途中・失敗・版の違いを見分ける", () => {
    assert.deepEqual(checkUpload("SUCCEEDED", "0.1.9", "0.1.9"), { done: true });
    assert.deepEqual(checkUpload("IN_PROGRESS", undefined, "0.1.9"), { done: false });
    assert.deepEqual(checkUpload("UPLOAD_IN_PROGRESS", undefined, "0.1.9"), { done: false });
    assert.throws(() => checkUpload("FAILED", undefined, "0.1.9"), /上げられませんでした/);
    assert.throws(() => checkUpload("SUCCEEDED", "0.1.8", "0.1.9"), /0\.1\.8.*0\.1\.9/);
  });
  it("審査中・止めて待つ・公開済みは問題なし。却下・取り消しはだめ", () => {
    for (const s of ["PENDING_REVIEW", "STAGED", "PUBLISHED"]) assert.equal(checkPublish(s), s);
    for (const s of ["REJECTED", "CANCELLED", undefined]) assert.throws(() => checkPublish(s), /審査に出せませんでした/);
  });
});

describe("submit", () => {
  it("トークンをもらい、ZIP を上げ、止めておく形で審査に出す", async () => {
    const { fetch, calls } = fakeFetch([
      { json: { access_token: "ya29.secret" } },
      { json: { uploadState: "SUCCEEDED", crxVersion: "0.1.9" } },
      { json: { state: "PENDING_REVIEW" } },
    ]);
    const r = await submit({ ...base, publishType: "STAGED_PUBLISH", fetch });
    assert.equal(r.state, "PENDING_REVIEW");
    assert.equal(calls[0]!.url, "https://oauth2.googleapis.com/token");
    assert.match(String(calls[0]!.body), /grant_type=refresh_token/);
    assert.equal(calls[1]!.url, `https://chromewebstore.googleapis.com/upload/v2/publishers/pub1/items/${DEFAULT_ITEM_ID}:upload`);
    assert.equal(calls[1]!.headers.authorization, "Bearer ya29.secret");
    assert.equal(calls[2]!.url, `https://chromewebstore.googleapis.com/v2/publishers/pub1/items/${DEFAULT_ITEM_ID}:publish`);
    assert.deepEqual(JSON.parse(String(calls[2]!.body)), { publishType: "STAGED_PUBLISH" });
  });

  it("上げるのに時間がかかれば、状態を読んで終わるまで待つ", async () => {
    const { fetch, calls } = fakeFetch([
      { json: { access_token: "t" } },
      { json: { uploadState: "IN_PROGRESS" } },
      { json: { lastAsyncUploadState: "IN_PROGRESS" } },
      { json: { lastAsyncUploadState: "SUCCEEDED" } },
      { json: { state: "STAGED" } },
    ]);
    const r = await submit({ ...base, publishType: "STAGED_PUBLISH", fetch });
    assert.equal(r.state, "STAGED");
    assert.equal(calls.filter((c) => c.url.endsWith(":fetchStatus")).length, 2);
  });

  it("鍵が足りなければ、どこにも繋がずに止まる", async () => {
    const { fetch, calls } = fakeFetch([]);
    await assert.rejects(submit({ ...base, refreshToken: "", publishType: "STAGED_PUBLISH", fetch }), /CWS_REFRESH_TOKEN/);
    assert.equal(calls.length, 0);
  });

  it("API が失敗したら止まり、エラーの文にトークンを出さない", async () => {
    const { fetch } = fakeFetch([
      { json: { access_token: "ya29.secret" } },
      { status: 400, text: '{"error":{"message":"bad ya29.secret"}}' },
    ]);
    await assert.rejects(submit({ ...base, publishType: "STAGED_PUBLISH", fetch }), (e: Error) => {
      assert.match(e.message, /HTTP 400/);
      assert.doesNotMatch(e.message, /ya29\.secret/);
      return true;
    });
  });

  it("上がった版が違えば、審査に出さない", async () => {
    const { fetch, calls } = fakeFetch([
      { json: { access_token: "t" } },
      { json: { uploadState: "SUCCEEDED", crxVersion: "0.1.8" } },
    ]);
    await assert.rejects(submit({ ...base, publishType: "STAGED_PUBLISH", fetch }), /0\.1\.8/);
    assert.ok(!calls.some((c) => c.url.endsWith(":publish")));
  });

  it("公開のしかたは 2 つだけ", async () => {
    const { fetch } = fakeFetch([]);
    await assert.rejects(submit({ ...base, publishType: "PUBLISH_NOW", fetch }), /STAGED_PUBLISH/);
  });
});
