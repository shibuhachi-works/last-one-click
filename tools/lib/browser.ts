import { chromium, type BrowserContext } from "playwright";
import path from "node:path";

/** ログイン状態を保持する Chrome プロファイル。.gitignore 済み */
export const PROFILE_DIR = path.resolve(process.cwd(), ".profile");

/**
 * 永続プロファイルで Chromium を起動する。
 * headless にはしない(人間が最後に公開ボタンを押す前提のため)。
 */
export async function launchPersistent(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: "ja-JP",
    // 自動操作の検知を外す指定(--disable-blink-features=AutomationControlled)は入れない。
    // 規約との関係で説明しにくく、「公開ボタンを押さない」方針とも合わないため。
    // ログイン(npm run login)と下書き(npm run draft)で同じブラウザを使う。下書きは拡張を読み込むので Playwright の Chromium だけ
    // (Google Chrome はコマンドから拡張を読み込めない)。PIGEON_BROWSER_CHANNEL は使わない(#178)
  });
}
