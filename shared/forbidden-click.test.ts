import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenClickError, assertClickAllowed, isForbiddenClickText, normalizeLabel } from "./forbidden-click.js";

describe("isForbiddenClickText", () => {
  const forbidden = [
    "投稿する",
    "公開する",
    "投稿",
    "公開",
    "有料で公開する",
    "有料で投稿する",
    "今すぐ公開する",
    "予約投稿",
    "記事を公開する",
    "更新する",
    "Publish",
    "POST",
    "Tweet",
    " 投稿する ",
    "投稿する！",
    "投　稿　す　る", // 全角スペース入り
    "公開する →",
  ];
  for (const t of forbidden) {
    it(`禁止: ${JSON.stringify(t)}`, () => assert.equal(isForbiddenClickText(t), true));
  }

  const allowed = [
    "公開に進む",
    "公開設定",
    "公開設定を保存",
    "下書き保存",
    "下書きに戻す",
    "画像を追加",
    "見出し画像",
    "保存",
    "適用",
    "マガジン",
    "マガジンA",
    "ハッシュタグを追加",
    "投稿一覧",
    "閉じる",
    "キャンセル",
    "有料エリア設定", // 有料の記事の、ラインを引く画面を開くボタン(押してよい)
    "ラインをこの場所に変更",
    "",
    null,
    undefined,
  ];
  for (const t of allowed) {
    it(`許可: ${JSON.stringify(t)}`, () => assert.equal(isForbiddenClickText(t), false));
  }
});

describe("normalizeLabel", () => {
  it("全角英数を半角に、空白を除去、末尾記号を除去、小文字化", () => {
    assert.equal(normalizeLabel("Ｐｕｂｌｉｓｈ ！"), "publish");
    assert.equal(normalizeLabel("  公開 する  "), "公開する");
  });
});

describe("assertClickAllowed", () => {
  it("どのラベルも安全なら何も起きない", () => {
    assert.doesNotThrow(() => assertClickAllowed(["公開に進む", null, "next"]));
  });
  it("aria-label だけが禁止文字でも投げる", () => {
    assert.throws(() => assertClickAllowed(["", "投稿する"], "fillPublishSettings"), ForbiddenClickError);
  });
  it("エラー文に押そうとした文字と文脈が入る", () => {
    try {
      assertClickAllowed(["公開する"], "test");
      assert.fail("should throw");
    } catch (e) {
      assert.ok(e instanceof ForbiddenClickError);
      assert.match(e.message, /公開する/);
      assert.match(e.message, /test/);
    }
  });
});
