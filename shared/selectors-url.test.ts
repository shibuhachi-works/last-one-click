import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkSelectorsUrl, SELECTORS_URL_ARTICLE_MESSAGE } from "./selectors-url.js";

describe("checkSelectorsUrl", () => {
  it("空(前後の空白だけも)は既定値を使うので通す", () => {
    assert.equal(checkSelectorsUrl(""), null);
    assert.equal(checkSelectorsUrl("   "), null);
  });
  it("raw の .json は通す", () => {
    assert.equal(checkSelectorsUrl("https://raw.githubusercontent.com/owner/repo/main/selectors/note.json"), null);
  });
  it("記事の md の URL は、記事の欄へ案内する", () => {
    assert.equal(
      checkSelectorsUrl("https://github.com/owner/repo/blob/main/templates/note/article.md"),
      SELECTORS_URL_ARTICLE_MESSAGE,
    );
    assert.equal(checkSelectorsUrl("https://raw.githubusercontent.com/owner/repo/main/posts/a/article.md"), SELECTORS_URL_ARTICLE_MESSAGE);
  });
  it("記事のフォルダの URL も、記事の欄へ案内する", () => {
    assert.equal(checkSelectorsUrl("https://github.com/owner/repo/tree/main/posts/a"), SELECTORS_URL_ARTICLE_MESSAGE);
  });
  it("github.com の .json のページは、raw の URL にするよう案内する", () => {
    const msg = checkSelectorsUrl("https://github.com/owner/repo/blob/main/selectors/note.json");
    assert.ok(msg && msg.includes("raw.githubusercontent.com"));
  });
  it("http と、URL でない文字は通さない", () => {
    assert.ok(checkSelectorsUrl("http://raw.githubusercontent.com/owner/repo/main/selectors/note.json"));
    assert.ok(checkSelectorsUrl("note.json"));
  });
});
