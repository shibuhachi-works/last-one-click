import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderWebhookMessage } from "./webhook-message.js";

const vars = { title: "白の靴下", default: "Last One Click: 下書きが完了しました\n白の靴下。確かめてください。" };

describe("renderWebhookMessage", () => {
  it("決めていない・空なら既定の文", () => {
    assert.equal(renderWebhookMessage(undefined, vars), vars.default);
    assert.equal(renderWebhookMessage("  ", vars), vars.default);
  });
  it("{title}・{default}・\\n を置き換える", () => {
    assert.equal(
      renderWebhookMessage("「{title}」の下書きができました\\nつなぐ: rdp://x", vars),
      "「白の靴下」の下書きができました\nつなぐ: rdp://x",
    );
    assert.equal(renderWebhookMessage("{default}\\n<rdp://x|開く>", vars), `${vars.default}\n<rdp://x|開く>`);
  });
  it("タイトルの中の {default} は置き換えない", () => {
    assert.equal(renderWebhookMessage("{title}", { ...vars, title: "{default}" }), "{default}");
  });
});
