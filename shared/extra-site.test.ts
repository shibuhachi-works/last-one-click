// 追加の対応先(library.libecity.com)の案内と、許可・登録の合わせ方を、chrome の API の偽物で確かめる
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  EXTRA_SITE_DEFAULT_SELECTORS,
  EXTRA_SITE_EDITOR_PROBE,
  acceptsFile,
  extraSiteUnsupportedNotes,
  fillProbe,
  resolveExtraSiteSelectors,
  shouldFillExtraSite,
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
    async probe(_tabId, probe) {
      api.calls.push(probe ? `probe:${probe.title[0]}` : "probe");
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
  it("そのサイトのエディタで、許可が無く、入力欄があるときは、エディタ向けの案内を出す", async () => {
    const api = fakeApi();
    assert.equal(await shouldOfferExtraSite(api, EDITOR_TAB), "editor");
    assert.deepEqual(api.calls, ["contains", "probe"]);
  });

  it("ホストが違うとき(note のページ・ほかのページ)は出さず、ページの中で何も動かさない", async () => {
    for (const url of ["https://editor.note.com/notes/new", "https://note.com/", "https://example.com/", undefined]) {
      const api = fakeApi();
      assert.equal(await shouldOfferExtraSite(api, { id: 1, url }), null, String(url));
      assert.deepEqual(api.calls, [], String(url));
    }
  });

  it("タブが無いときは出さない", async () => {
    const api = fakeApi();
    assert.equal(await shouldOfferExtraSite(api, undefined), null);
    assert.equal(await shouldOfferExtraSite(api, { url: EDITOR_TAB.url }), null);
    assert.deepEqual(api.calls, []);
  });

  it("入力欄が無い(エディタ以外の)ページでも、ドメインが合えば、エディタを開くよう促す案内を出す", async () => {
    const api = fakeApi({ editor: false });
    assert.equal(await shouldOfferExtraSite(api, EDITOR_TAB), "site");
    assert.deepEqual(api.calls, ["contains", "probe"]);
  });

  it("もう許可があるときは出さず、ページも見ない", async () => {
    const api = fakeApi({ granted: true });
    assert.equal(await shouldOfferExtraSite(api, EDITOR_TAB), null);
    assert.deepEqual(api.calls, ["contains"]);
  });

  it("ページに入れなかったとき(読み込み中など)も、ドメインが合えば、エディタを開くよう促す案内を出す", async () => {
    const api = fakeApi();
    api.probe = async () => {
      throw new Error("Cannot access contents of the page");
    };
    assert.equal(await shouldOfferExtraSite(api, EDITOR_TAB), "site");
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

describe("syncExtraSite(登録が見えないのに「同じ id がある」で失敗するとき)", () => {
  it("少し待って登録が見えてきたら、消さずにそのまま使う(別のところの登録が終わる途中だったとき)", async () => {
    const api = fakeApi({ granted: true });
    api.register = async () => {
      api.calls.push("register");
      setTimeout(() => (api.registered = true), 50); // 別のところの登録が、少しあとで見えてくる
      throw new Error("Duplicate script ID 'extra-site'");
    };
    assert.equal(await syncExtraSite(api), true);
    assert.deepEqual(api.calls.filter((c) => c !== "contains"), ["register"]);
  });

  it("一度消してから、もう一度だけ登録する(許可を外して付け直したとき)", async () => {
    const api = fakeApi({ granted: true });
    let stale = true; // Chrome には残っているが、getRegisteredContentScripts には出てこない登録
    api.register = async () => {
      api.calls.push("register");
      if (stale) throw new Error("Duplicate script ID 'extra-site'");
      api.registered = true;
    };
    api.unregister = async () => {
      api.calls.push("unregister");
      stale = false;
      api.registered = false;
    };
    assert.equal(await syncExtraSite(api), true);
    assert.equal(api.registered, true);
    assert.deepEqual(api.calls.filter((c) => c !== "contains"), ["register", "unregister", "register"]);
  });

  it("消して登録し直しても登録できなければ、エラーにする", async () => {
    const api = fakeApi({ granted: true });
    api.register = async () => {
      api.calls.push("register");
      throw new Error("Duplicate script ID 'extra-site'");
    };
    api.unregister = async () => {
      api.calls.push("unregister");
      throw new Error("Nonexistent script ID 'extra-site'");
    };
    await assert.rejects(syncExtraSite(api), /Duplicate script ID/);
    assert.deepEqual(api.calls.filter((c) => c !== "contains"), ["register", "unregister", "register"]);
  });
});

describe("EXTRA_SITE_EDITOR_PROBE(案内と診断に使う広めのセレクタ)", () => {
  it("タイトルと本文の両方に、1 つ以上ある", () => {
    assert.ok(EXTRA_SITE_EDITOR_PROBE.title.length > 0);
    assert.ok(EXTRA_SITE_EDITOR_PROBE.body.length > 0);
  });
});

describe("shouldFillExtraSite(このタブに下書きを入れるか)", () => {
  it("許可があり、編集画面なら true。狭いセレクタで確かめる", async () => {
    const api = fakeApi({ granted: true });
    assert.equal(await shouldFillExtraSite(api, EDITOR_TAB), true);
    assert.deepEqual(api.calls, ["contains", `probe:${fillProbe().title[0]}`]);
  });

  it("許可が無ければ、ページの中では何も動かさない", async () => {
    const api = fakeApi({ granted: false });
    assert.equal(await shouldFillExtraSite(api, EDITOR_TAB), false);
    assert.deepEqual(api.calls, ["contains"]);
  });

  it("note のページ・ほかのホストでは false", async () => {
    const api = fakeApi({ granted: true });
    assert.equal(await shouldFillExtraSite(api, { id: 1, url: "https://editor.note.com/new" }), false);
    assert.equal(await shouldFillExtraSite(api, { id: 1, url: "https://library.libecity.com.example.com/" }), false);
    assert.deepEqual(api.calls, []);
  });

  it("編集画面でなければ false。確かめに失敗しても false", async () => {
    assert.equal(await shouldFillExtraSite(fakeApi({ granted: true, editor: false }), EDITOR_TAB), false);
    const api = fakeApi({ granted: true });
    api.probe = async () => {
      throw new Error("Cannot access");
    };
    assert.equal(await shouldFillExtraSite(api, EDITOR_TAB), false);
  });
});

describe("selectors/extra-site.json", () => {
  const json = JSON.parse(readFileSync(new URL("../selectors/extra-site.json", import.meta.url), "utf8"));

  it("同梱の値は、コードの既定値と同じ(ファイルが無くても同じに動く)", () => {
    assert.deepEqual(resolveExtraSiteSelectors(json), EXTRA_SITE_DEFAULT_SELECTORS);
    assert.deepEqual(Object.keys(json).sort(), Object.keys(EXTRA_SITE_DEFAULT_SELECTORS).sort());
  });

  it("無い・形が違うときは既定値。項目ごとに合わせる", () => {
    assert.deepEqual(resolveExtraSiteSelectors(null), EXTRA_SITE_DEFAULT_SELECTORS);
    assert.deepEqual(resolveExtraSiteSelectors([1]), EXTRA_SITE_DEFAULT_SELECTORS);
    const r = resolveExtraSiteSelectors({ title: ["#t"], body: [], tagInput: "x", bodyImageInput: [1], unknown: ["a"] });
    assert.deepEqual(r.title, ["#t"]);
    assert.deepEqual(r.body, EXTRA_SITE_DEFAULT_SELECTORS.body);
    assert.deepEqual(r.tagInput, EXTRA_SITE_DEFAULT_SELECTORS.tagInput);
    assert.deepEqual(r.bodyImageInput, EXTRA_SITE_DEFAULT_SELECTORS.bodyImageInput);
    assert.equal(Object.hasOwn(r, "unknown"), false);
  });

  it("既定値を書き換えない", () => {
    const r = resolveExtraSiteSelectors({});
    r.title.push("#x");
    assert.equal(EXTRA_SITE_DEFAULT_SELECTORS.title.includes("#x"), false);
  });
});

describe("acceptsFile", () => {
  const png = { name: "a.PNG", mimeType: "image/png" };
  const gif = { name: "a.gif", mimeType: "image/gif" };
  it("accept の拡張子・種類・image/* で見る", () => {
    assert.equal(acceptsFile(".png,.jpg,.jpeg", png), true);
    assert.equal(acceptsFile(".png,.jpg,.jpeg", gif), false);
    assert.equal(acceptsFile("image/jpeg", { name: "x", mimeType: "image/jpeg" }), true);
    assert.equal(acceptsFile("image/*", gif), true);
  });
  it("accept が空なら png・jpg だけ", () => {
    assert.equal(acceptsFile("", png), true);
    assert.equal(acceptsFile(null, { name: "a.jpg", mimeType: "image/jpeg" }), true);
    assert.equal(acceptsFile(undefined, gif), false);
    assert.equal(acceptsFile("", { name: "a.webp", mimeType: "image/webp" }), false);
  });
});

describe("extraSiteUnsupportedNotes(追加の対応先のエディタでは入らない書き方)", () => {
  it("ふつうの段落・見出し・太字・リンク・引用だけなら、何も出さない", () => {
    const html = "<h2>見出し</h2><p><strong>太字</strong> <a href=\"https://example.com\">リンク</a></p><blockquote><p>引用</p></blockquote>";
    assert.deepEqual(extraSiteUnsupportedNotes({ html }), []);
  });

  it("箇条書き・番号付きリスト・コード・表を知らせる", () => {
    const notes = extraSiteUnsupportedNotes({ html: "<ul><li>a</li></ul><ol start=\"2\"><li>b</li></ol><pre><code>x</code></pre><table><tr><td>1</td></tr></table>" });
    assert.equal(notes.length, 3);
    assert.match(notes[0]!, /箇条書き/);
    assert.match(notes[1]!, /コード/);
    assert.match(notes[2]!, /表/);
  });

  it("目次・埋め込み・マガジン・価格・gif の画像を知らせる", () => {
    const notes = extraSiteUnsupportedNotes({
      html: "<p>a</p>",
      insertToc: true,
      embedUrls: true,
      magazine: "マガジンA",
      price: 300,
      images: [
        { name: "a.png", mimeType: "image/png" },
        { name: "b.gif", mimeType: "image/gif" },
      ],
    });
    assert.equal(notes.length, 5);
    assert.match(notes[4]!, /b\.gif/);
    assert.doesNotMatch(notes[4]!, /a\.png/);
  });

  it("本文の画像のキャプションは入れないと知らせる(png・jpg 以外の画像は、そちらで知らせる)", () => {
    const notes = extraSiteUnsupportedNotes({
      html: "<p>a</p>",
      images: [
        { name: "a.png", mimeType: "image/png", caption: "説明" },
        { name: "b.gif", mimeType: "image/gif", caption: "説明" },
        { name: "c.jpg", mimeType: "image/jpeg" },
      ],
    });
    assert.equal(notes.length, 2);
    assert.match(notes[1]!, /キャプション\(a\.png。/);
  });

  it("<code> を含まない「codec」などの文字では出さない", () => {
    assert.deepEqual(extraSiteUnsupportedNotes({ html: "<p>&lt;ul&gt; codec preview</p>" }), []);
  });
});
