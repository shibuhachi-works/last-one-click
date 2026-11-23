// ポップアップのアカウントの表示を、どこに聞くか(#127)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadPopupAccount, type AccountReply, type PopupAccountDeps } from "./popup-account.js";

const USER = { name: "見本の書き手", id: "sample_writer" };

function deps(o: { tab?: number; tabReply?: AccountReply | Error; bgReply?: AccountReply | Error }) {
  const calls: string[] = [];
  const d: PopupAccountDeps = {
    findNoteTab: async () => o.tab,
    askTab: async (id) => {
      calls.push(`tab:${id}`);
      if (o.tabReply instanceof Error) throw o.tabReply;
      return o.tabReply ?? null;
    },
    askBackground: async () => {
      calls.push("background");
      if (o.bgReply instanceof Error) throw o.bgReply;
      return o.bgReply ?? null;
    },
  };
  return { d, calls };
}

describe("loadPopupAccount", () => {
  it("note のタブがあればタブに聞き、background には聞かない", async () => {
    const { d, calls } = deps({ tab: 7, tabReply: { account: USER }, bgReply: { account: { name: "別の人" } } });
    assert.deepEqual(await loadPopupAccount(d), USER);
    assert.deepEqual(calls, ["tab:7"]);
  });

  it("タブが「読めない」(null)と答えたら、background にも聞かずに何も出さない(問い合わせは 1 回だけ)", async () => {
    const { d, calls } = deps({ tab: 7, tabReply: { account: null }, bgReply: { account: USER } });
    assert.equal(await loadPopupAccount(d), null);
    assert.deepEqual(calls, ["tab:7"]);
  });

  it("note のタブが無いときだけ、background に 1 回聞く", async () => {
    const { d, calls } = deps({ bgReply: { account: USER } });
    assert.deepEqual(await loadPopupAccount(d), USER);
    assert.deepEqual(calls, ["background"]);
  });

  it("タブから返事が無いとき(content script が居ない・失敗)は、background に 1 回聞く", async () => {
    for (const tabReply of [null, new Error("Receiving end does not exist")]) {
      const { d, calls } = deps({ tab: 3, tabReply, bgReply: { account: USER } });
      assert.deepEqual(await loadPopupAccount(d), USER);
      assert.deepEqual(calls, ["tab:3", "background"]);
    }
  });

  it("background が読めない(401 など)・返事が無い・失敗したときは null", async () => {
    for (const bgReply of [{ account: null }, null, new Error("x")]) {
      const { d } = deps({ bgReply });
      assert.equal(await loadPopupAccount(d), null);
    }
  });

  it("名前の無い答えは出さない", async () => {
    const { d } = deps({ bgReply: { account: { name: "" } } });
    assert.equal(await loadPopupAccount(d), null);
  });

  it("タブを探すのに失敗したら、background に聞く", async () => {
    const { d, calls } = deps({ bgReply: { account: USER } });
    d.findNoteTab = async () => {
      throw new Error("x");
    };
    assert.deepEqual(await loadPopupAccount(d), USER);
    assert.deepEqual(calls, ["background"]);
  });
});
