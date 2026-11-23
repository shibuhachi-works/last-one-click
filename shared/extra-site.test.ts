// 追加の対応先(library.libecity.com)の案内と、許可・登録の合わせ方を、chrome の API の偽物で確かめる
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXTRA_SITE_EDITOR_PROBE,
  disableExtraSite,
  enableExtraSite,
  isExtraSiteUrl,
  shouldOfferExtraSite,
  syncExtraSite,
  type ExtraSiteApi,
} from "./extra-site.js";

type Fake = ExtraSiteApi & { granted: boolean; registered: boolean; calls: string[]; answer: boolean; editor: boolean };

function fakeApi(init: Partial<Pick<Fake, "granted" | "registered" | "answer" | "editor">> = {}): Fake {
  const api: Fake = {
    granted: false,
    registered: false,
    answer: true,
    editor: true,
    calls: [],
    ...init,
    async hasPermission() {
      api.calls.push("contains");
      return api.granted;
    },
    async requestPermission() {
      api.calls.push("request");
      api.granted = api.answer;
      return api.answer;
    },
    async removePermission() {
      api.calls.push("remove");
      api.granted = false;
      return true;
    },
    async isRegistered() {
      return api.registered;
    },
    async register() {
      api.calls.push("register");
      if (api.registered) throw new Error("Duplicate script ID");
      api.registered = true;
    },
    async unregister() {
      api.calls.push("unregister");
      api.registered = false;
    },
    async probe() {
      api.calls.push("probe");
      return api.editor;
    },
  };
  return api;
}

const EDITOR_TAB = { id: 1, url: "https://library.libecity.com/articles/new" };

describe("isExtraSiteUrl", () => {
  it("https で、ホストが完全に一致するときだけ", () => {
    assert.equal(isExtraSiteUrl("https://library.libecity.com/articles/new"), true);
    assert.equal(isExtraSiteUrl("https://library.libecity.com/"), true);
    assert.equal(isExtraSiteUrl("http://library.libecity.com/"), false);
    assert.equal(isExtraSiteUrl("https://library.libecity.com.example.com/"), false);
    assert.equal(isExtraSiteUrl("https://evil.example.com/?u=https://library.libecity.com/"), false);
    assert.equal(isExtraSiteUrl("https://editor.note.com/notes/new"), false);
    assert.equal(isExtraSiteUrl("chrome-extension://abc/popup.html"), false);
    assert.equal(isExtraSiteUrl(undefined), false);
    assert.equal(isExtraSiteUrl("not a url"), false);
  });
});

describe("shouldOfferExtraSite(ポップアップの案内)", () => {
  it("そのサイトのエディタで、許可が無く、入力欄があるときだけ出す", async () => {
    const api = fakeApi();
    assert.equal(await shouldOfferExtraSite(api, EDITOR_TAB), true);
    assert.deepEqual(api.calls, ["contains", "probe"]);
  });

  it("ホストが違うとき(note のページ・ほかのページ)は出さず、ページの中で何も動かさない", async () => {
    for (const url of ["https://editor.note.com/notes/new", "https://note.com/", "https://example.com/", undefined]) {
      const api = fakeApi();
      assert.equal(await shouldOfferExtraSite(api, { id: 1, url }), false, String(url));
      assert.deepEqual(api.calls, [], String(url));
    }
  });

  it("タブが無いときは出さない", async () => {
    const api = fakeApi();
    assert.equal(await shouldOfferExtraSite(api, undefined), false);
    assert.equal(await shouldOfferExtraSite(api, { url: EDITOR_TAB.url }), false);
    assert.deepEqual(api.calls, []);
  });

  it("入力欄が無いときは出さない", async () => {
    const api = fakeApi({ editor: false });
    assert.equal(await shouldOfferExtraSite(api, EDITOR_TAB), false);
  });

  it("もう許可があるときは出さず、ページも見ない", async () => {
    const api = fakeApi({ granted: true });
    assert.equal(await shouldOfferExtraSite(api, EDITOR_TAB), false);
    assert.deepEqual(api.calls, ["contains"]);
  });

  it("ページに入れなかったときは出さない", async () => {
    const api = fakeApi();
    api.probe = async () => {
      throw new Error("Cannot access contents of the page");
    };
    assert.equal(await shouldOfferExtraSite(api, EDITOR_TAB), false);
  });
});

describe("enableExtraSite(「使えるようにする」)", () => {
  it("最初に許可を求め、許可されたら content script を登録する", async () => {
    const api = fakeApi();
    assert.equal(await enableExtraSite(api), true);
    assert.equal(api.calls[0], "request");
    assert.equal(api.registered, true);
  });

  it("許可を求める呼び出しは、await を挟まずに起きる(クリックの中で呼ぶため)", () => {
    const api = fakeApi();
    void enableExtraSite(api);
    assert.deepEqual(api.calls, ["request"]);
  });

  it("許可されなかったら、何も変えない", async () => {
    const api = fakeApi({ answer: false });
    assert.equal(await enableExtraSite(api), false);
    assert.deepEqual(api.calls, ["request"]);
    assert.equal(api.registered, false);
  });
});

describe("disableExtraSite(スイッチを切る)", () => {
  it("許可を外し、登録も消す", async () => {
    const api = fakeApi({ granted: true, registered: true });
    assert.equal(await disableExtraSite(api), false);
    assert.equal(api.granted, false);
    assert.equal(api.registered, false);
  });
});

describe("syncExtraSite(起動時・Chrome の画面で許可を変えられたとき)", () => {
  it("許可があって登録が無ければ、作り直す", async () => {
    const api = fakeApi({ granted: true });
    assert.equal(await syncExtraSite(api), true);
    assert.equal(api.registered, true);
  });

  it("許可が外されたら、登録を消す", async () => {
    const api = fakeApi({ granted: false, registered: true });
    assert.equal(await syncExtraSite(api), false);
    assert.equal(api.registered, false);
  });

  it("どちらも合っていれば、何もしない", async () => {
    for (const state of [{ granted: true, registered: true }, { granted: false, registered: false }]) {
      const api = fakeApi(state);
      await syncExtraSite(api);
      assert.deepEqual(api.calls, ["contains"]);
    }
  });

  it("別のところが先に登録していて失敗しても、登録があれば良しとする", async () => {
    const api = fakeApi({ granted: true });
    api.isRegistered = async () => api.calls.includes("register");
    api.register = async () => {
      api.calls.push("register");
      throw new Error("Duplicate script ID");
    };
    assert.equal(await syncExtraSite(api), true);
  });
});

describe("EXTRA_SITE_EDITOR_PROBE(仮のセレクタ)", () => {
  it("タイトルと本文の両方に、1 つ以上ある", () => {
    assert.ok(EXTRA_SITE_EDITOR_PROBE.title.length > 0);
    assert.ok(EXTRA_SITE_EDITOR_PROBE.body.length > 0);
  });
});
