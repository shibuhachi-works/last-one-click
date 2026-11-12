// CI と同じく extension の npm ci で入る Chrome API の型を使う。
/// <reference path="../extension/node_modules/@types/chrome/index.d.ts" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { DEFAULT_SELECTORS_URL, loadSelectors } from "../extension/src/lib/selectors.js";
import { STORAGE } from "../extension/src/lib/types.js";
import { validateSelectorsJson } from "./selectors-schema.js";

const fixture = JSON.parse(readFileSync(new URL("../selectors/note.json", import.meta.url), "utf8"));
const selectors = (title: string) => validateSelectorsJson({ ...fixture, title });
const remote = selectors(".remote-title");
const cached = selectors(".cached-title");
const bundled = selectors(".bundled-title");
const invalid = { ...remote, newNoteUrl: "https://invalid.example/new" };
const now = 1_800_000_000_000;
const hour = 60 * 60 * 1000;
const bundledUrl = "chrome-extension://test/selectors.json";
const fakeToken = "test-only-token";

describe("loadSelectors", { concurrency: false }, () => {
  let stored: Record<string, unknown>;
  let writes: Record<string, unknown>[];
  let removed: string[];
  let requests: { url: string; init?: RequestInit }[];
  let remoteReply: () => Promise<Response>;
  let originalChrome: PropertyDescriptor | undefined;

  const cache = (age: number, data: unknown = cached, url = DEFAULT_SELECTORS_URL) => {
    stored[STORAGE.selectorsCache] = { url, fetchedAt: now - age, data };
  };
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

  beforeEach(() => {
    stored = {};
    writes = [];
    removed = [];
    requests = [];
    remoteReply = async () => json(remote);
    originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
    Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
      storage: { local: {
        get: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, structuredClone(stored[key])])),
        set: async (values: Record<string, unknown>) => {
          writes.push(structuredClone(values));
          Object.assign(stored, structuredClone(values));
        },
        remove: async (key: string) => { removed.push(key); delete stored[key]; },
      } },
      runtime: { getURL: (path: string) => {
        assert.equal(path, "selectors.json");
        return bundledUrl;
      } },
    } });
    mock.method(Date, "now", () => now);
    // すべての fetch を差し替え、実際のネットワークへは接続しない。
    mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === bundledUrl) return json(bundled);
      return remoteReply();
    });
  });

  afterEach(() => {
    mock.restoreAll();
    if (originalChrome) Object.defineProperty(globalThis, "chrome", originalChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
  });

  it("1: キャッシュが無ければリモートを使い URL・時刻・値を保存する", async () => {
    assert.deepEqual(await loadSelectors(), { source: "remote", selectors: remote });
    assert.deepEqual(requests, [{ url: DEFAULT_SELECTORS_URL, init: { cache: "no-store", headers: {} } }]);
    assert.deepEqual(writes, [{ [STORAGE.selectorsCache]: { url: DEFAULT_SELECTORS_URL, fetchedAt: now, data: remote } }]);
  });

  it("2: 同じ URL の1時間以内のキャッシュなら通信しない", async () => {
    cache(hour - 1);
    assert.deepEqual(await loadSelectors(), { source: "cache", selectors: cached });
    assert.deepEqual(requests, []);
    assert.deepEqual(writes, []);
  });

  for (const age of [hour, hour + 1]) {
    it(`3: キャッシュが ${age}ms 前ならリモートから取り直す`, async () => {
      cache(age);
      assert.deepEqual(await loadSelectors(), { source: "remote", selectors: remote });
      assert.deepEqual(requests.map(r => r.url), [DEFAULT_SELECTORS_URL]);
      assert.equal(writes.length, 1);
    });
  }

  it("4: キャッシュの URL が現在の設定と異なれば取り直す", async () => {
    stored[STORAGE.selectorsUrl] = "https://example.com/selectors.json";
    cache(1);
    assert.deepEqual(await loadSelectors(), { source: "remote", selectors: remote });
    assert.deepEqual(requests.map(r => r.url), [stored[STORAGE.selectorsUrl]]);
    assert.deepEqual(writes, [{ [STORAGE.selectorsCache]: { url: stored[STORAGE.selectorsUrl], fetchedAt: now, data: remote } }]);
  });

  for (const failure of ["network unavailable", "503"]) {
    const fail = () => { remoteReply = async () => {
      if (failure === "503") return new Response(null, { status: 503 });
      throw new Error(failure);
    }; };
    it(`5: 取得失敗 (${failure}) なら古いキャッシュと理由を返す`, async () => {
      cache(hour + 1);
      fail();
      assert.deepEqual(await loadSelectors(), { source: "cache", selectors: cached, warning: failure });
      assert.deepEqual(requests.map(r => r.url), [DEFAULT_SELECTORS_URL]);
      assert.deepEqual(writes, []);
    });
    it(`6: 取得失敗 (${failure}) でキャッシュが無ければ同梱と理由を返す`, async () => {
      fail();
      assert.deepEqual(await loadSelectors(), { source: "bundled", selectors: bundled, warning: failure });
      assert.deepEqual(requests.map(r => r.url), [DEFAULT_SELECTORS_URL, bundledUrl]);
      assert.deepEqual(writes, []);
    });
  }

  it("7: 不正なリモート JSON を使わず保存せず、同梱に戻して理由を返す", async () => {
    remoteReply = async () => json(invalid);
    const result = await loadSelectors();
    assert.equal(result.source, "bundled");
    assert.deepEqual(result.selectors, bundled);
    assert.match(result.warning ?? "", /newNoteUrl/);
    assert.deepEqual(writes, []);
    assert.deepEqual(requests.map(r => r.url), [DEFAULT_SELECTORS_URL, bundledUrl]);
  });

  it("8: 新しくても不正なキャッシュは削除してリモートから取り直す", async () => {
    cache(1, invalid);
    remoteReply = async () => {
      assert.deepEqual(removed, [STORAGE.selectorsCache]);
      return json(remote);
    };
    assert.deepEqual(await loadSelectors(), { source: "remote", selectors: remote });
    assert.deepEqual(removed, [STORAGE.selectorsCache]);
    assert.deepEqual(requests.map(r => r.url), [DEFAULT_SELECTORS_URL]);
    assert.equal(writes.length, 1);
  });

  it("9: 保存済み URL が不正なら既定の URL から取得する", async () => {
    stored[STORAGE.selectorsUrl] = "https://github.com/example/repo/blob/main/article.md";
    assert.equal((await loadSelectors()).source, "remote");
    assert.deepEqual(requests.map(r => r.url), [DEFAULT_SELECTORS_URL]);
  });

  for (const url of [DEFAULT_SELECTORS_URL, "https://example.com/selectors.json", "https://raw.githubusercontent.com.example.com/selectors.json"]) {
    it(`10: トークンを raw.githubusercontent.com だけに付ける (${new URL(url).hostname})`, async () => {
      stored[STORAGE.selectorsUrl] = url;
      stored[STORAGE.githubToken] = fakeToken;
      await loadSelectors();
      assert.deepEqual(requests, [{ url, init: { cache: "no-store", headers: url === DEFAULT_SELECTORS_URL ? { Authorization: `Bearer ${fakeToken}` } : {} } }]);
    });
  }

  it("不正な古いキャッシュも取得失敗時に使わない", async () => {
    cache(hour + 1, invalid);
    remoteReply = async () => { throw new Error("offline"); };
    assert.deepEqual(await loadSelectors(), { source: "bundled", selectors: bundled, warning: "offline" });
    assert.deepEqual(writes, []);
  });

  it("別 URL のキャッシュは取得失敗時にも使わず、同梱にはトークンを送らない", async () => {
    cache(1, cached, "https://example.com/old.json");
    stored[STORAGE.githubToken] = fakeToken;
    remoteReply = async () => { throw new Error("offline"); };
    assert.deepEqual(await loadSelectors(), { source: "bundled", selectors: bundled, warning: "offline" });
    assert.deepEqual(requests[1], { url: bundledUrl, init: undefined });
  });
});
