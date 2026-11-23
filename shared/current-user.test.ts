// ログイン中の note アカウントを読む(#106)。応答は見本の JSON(本物の note の応答の形は、実機で人が確かめる)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diagnoseCurrentUser, fetchCurrentUser, readCurrentUser, resolveCurrentUserUrl, valueAt } from "./current-user.js";
import { DEFAULT_ACCOUNT, validateSelectorsJson } from "./selectors-schema.js";
import { readFileSync } from "node:fs";

const S = validateSelectorsJson(JSON.parse(readFileSync(new URL("../selectors/note.json", import.meta.url), "utf8"))).account;

const NAME = "見本の書き手";
const ID = "sample_writer_zq";
const ICON = "https://assets.st-note.com/production/uploads/images/111/profile_secret_zz.png";
const EMAIL = "someone@example.invalid";
const SAMPLE = { data: { id: 987654321, nickname: NAME, urlname: ID, profile_image_path: ICON, email: EMAIL, [ID]: { x: 1 } } };

type Call = { url: string; init: RequestInit };
function fakeFetch(res: { status: number; body?: unknown; text?: string } | Error) {
  const calls: Call[] = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (res instanceof Error) throw res;
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => (res.text !== undefined ? JSON.parse(res.text) : res.body),
    };
  };
  return { fn, calls };
}

describe("readCurrentUser(応答から名前・ID・アイコンを読む)", () => {
  it("見本の応答から、名前・ID・アイコンを読む", () => {
    assert.deepEqual(readCurrentUser(SAMPLE, S), { name: NAME, id: ID, iconUrl: ICON });
  });

  it("名前が無ければ ID を名前にする。アイコンが無ければ出さない", () => {
    assert.deepEqual(readCurrentUser({ data: { urlname: ID } }, S), { name: ID, id: ID });
  });

  it("道筋の候補を前から順に見る", () => {
    assert.deepEqual(readCurrentUser({ data: { name: NAME, user_profile_image_path: ICON } }, S), { name: NAME, iconUrl: ICON });
  });

  it("形が違えば null", () => {
    for (const data of [null, "x", [], {}, { data: null }, { data: [] }, { data: { nickname: "" } }, { data: { nickname: { a: 1 } } }, { error: "x" }]) {
      assert.equal(readCurrentUser(data, S), null, JSON.stringify(data));
    }
  });

  it("アイコンは https の URL だけ(javascript: や http: は出さない)", () => {
    for (const icon of ["javascript:alert(1)", "http://example.com/a.png", "data:image/png;base64,AAAA", "/a.png", 1]) {
      assert.deepEqual(readCurrentUser({ data: { nickname: NAME, profile_image_path: icon } }, S), { name: NAME }, String(icon));
    }
  });

  it("長い名前は切り、改行は空白にする", () => {
    const r = readCurrentUser({ data: { nickname: `あ\nい${"う".repeat(100)}` } }, S);
    assert.ok(r && r.name.startsWith("あ い") && r.name.length <= 61 && r.name.endsWith("…"), String(r?.name));
  });

  it("プロトタイプのキーはたどらない", () => {
    assert.equal(valueAt({ data: {} }, "data.constructor"), undefined);
    assert.equal(valueAt({}, "__proto__"), undefined);
  });
});

describe("fetchCurrentUser(1 回だけ問い合わせる)", () => {
  it("selectors の URL に GET で 1 回だけ問い合わせ、Cookie はブラウザに任せる(credentials: include)。転送はたどらない", async () => {
    const f = fakeFetch({ status: 200, body: SAMPLE });
    assert.deepEqual(await fetchCurrentUser(S, "https://editor.note.com", f.fn), { name: NAME, id: ID, iconUrl: ICON });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0]!.url, "https://note.com/api/v2/current_user");
    assert.equal(f.calls[0]!.init.method, "GET");
    assert.equal(f.calls[0]!.init.credentials, "include");
    assert.equal(f.calls[0]!.init.redirect, "error");
    assert.equal(f.calls[0]!.init.body, undefined);
  });

  it("401・500 のときは null(投げない)", async () => {
    for (const status of [401, 403, 404, 500]) {
      assert.equal(await fetchCurrentUser(S, "https://note.com", fakeFetch({ status, body: { error: "login required" } }).fn), null, String(status));
    }
  });

  it("通信の失敗・JSON でない応答・形の違う応答のときは null(投げない)", async () => {
    assert.equal(await fetchCurrentUser(S, "https://note.com", fakeFetch(new TypeError("Failed to fetch")).fn), null);
    assert.equal(await fetchCurrentUser(S, "https://note.com", fakeFetch({ status: 200, text: "<!doctype html>" }).fn), null);
    assert.equal(await fetchCurrentUser(S, "https://note.com", fakeFetch({ status: 200, body: { data: { other: 1 } } }).fn), null);
  });

  it("応答が来なければ、待つ時間を過ぎたところで null", async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<never>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    assert.equal(await fetchCurrentUser(S, "https://note.com", hang, 20), null);
  });

  it("ヘッダーのあと本文が止まっても、待つ時間を過ぎたところで null(本文の読み取りまで待つ時間をかける)", async () => {
    let aborted = false;
    const stall = async (_url: string, init: RequestInit) => {
      init.signal?.addEventListener("abort", () => (aborted = true));
      return { ok: true, status: 200, json: () => new Promise<never>(() => {}) };
    };
    assert.equal(await fetchCurrentUser(S, "https://note.com", stall, 20), null);
    assert.ok(aborted, "止まった問い合わせを中断していません");
    const d = await diagnoseCurrentUser(S, "https://note.com", stall, 20);
    assert.match(d.lines.join("\n"), /- 応答: ありません\(TimeoutError\)/);
  });

  it("付けたあとの origin が note のものでなければ、問い合わせない", async () => {
    for (const url of ["/\\outside.example/api/x", "https://outside.example/api/x"]) {
      assert.throws(() => resolveCurrentUserUrl(url, "https://note.com"), url);
      const f = fakeFetch({ status: 200, body: SAMPLE });
      assert.equal(await fetchCurrentUser({ ...S, currentUserUrl: url }, "https://note.com", f.fn), null);
      assert.equal(f.calls.length, 0, url);
    }
  });

  it('"/" で始まる URL は、開いている note のページの origin に付ける', () => {
    assert.equal(resolveCurrentUserUrl("/api/v2/current_user", "https://editor.note.com"), "https://editor.note.com/api/v2/current_user");
    assert.equal(resolveCurrentUserUrl(DEFAULT_ACCOUNT.currentUserUrl, "https://editor.note.com"), "https://note.com/api/v2/current_user");
  });
});

describe("diagnoseCurrentUser(診断の節。値は出さない)", () => {
  const hidden = [NAME, ID, ICON, "profile_secret_zz", EMAIL, "987654321"];

  it("応答の有無・HTTP の状態・読めた道筋と文字数だけを出す", async () => {
    const d = await diagnoseCurrentUser(S, "https://editor.note.com", fakeFetch({ status: 200, body: SAMPLE }).fn);
    const text = d.lines.join("\n");
    assert.match(text, /### ログイン中のユーザーの問い合わせ/);
    assert.match(text, /- 問い合わせ先: note\.com\/api\/v2\/current_user/);
    assert.match(text, /- 応答: あり、HTTP 200/);
    assert.match(text, new RegExp(`- 名前: data\\.nickname \\(文字 ${NAME.length} 字\\)`));
    assert.match(text, new RegExp(`- ID: data\\.urlname \\(文字 ${ID.length} 字\\)`));
    assert.match(text, /- アイコン: data\.profile_image_path \(文字 \d+ 字\)/);
    assert.match(text, /data\.email \(文字 \d+ 字\)/);
    // 値と同じ文字のキー(ID をキーにした所)は伏せる
    assert.match(text, /data\.\*\*\* \(オブジェクト\)/);
    for (const s of hidden) assert.ok(!text.includes(s), `${s} が出ています\n${text}`);
    // 読めた値は、レポート全体から伏せる
    for (const s of [NAME, ID, ICON]) assert.ok(d.secrets.has(s), s);
  });

  it("使わなかった候補の道筋の値も伏せる(先の候補が null のとき、後の候補を名前に使う)", async () => {
    const data = { data: { nickname: null, name: "控えの名前テスト", urlname: ID } };
    assert.equal(readCurrentUser(data, S)?.name, "控えの名前テスト");
    const d = await diagnoseCurrentUser(S, "https://note.com", fakeFetch({ status: 200, body: data }).fn);
    const text = d.lines.join("\n");
    assert.ok(d.secrets.has("控えの名前テスト"));
    assert.match(text, /- 名前: data\.name \(文字 8 字\)/);
    assert.ok(!text.includes("控えの名前テスト"), text);
  });

  it("401 のときは状態だけ、通信の失敗のときは応答が無いことだけを出す", async () => {
    const d401 = (await diagnoseCurrentUser(S, "https://note.com", fakeFetch({ status: 401, body: { error: { message: "x" } } }).fn)).lines.join("\n");
    assert.match(d401, /HTTP 401/);
    assert.match(d401, /- 名前: 見つかりません/);
    const fail = (await diagnoseCurrentUser(S, "https://note.com", fakeFetch(new TypeError("Failed to fetch")).fn)).lines.join("\n");
    assert.match(fail, /- 応答: ありません\(TypeError\)/);
    const html = (await diagnoseCurrentUser(S, "https://note.com", fakeFetch({ status: 200, text: "<html>" }).fn)).lines.join("\n");
    assert.match(html, /JSON として読めません/);
  });
});
