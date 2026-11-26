// Playwright 版が、ビルドした Chrome 拡張(extension/dist)を読み込んだブラウザを動かすための道具(#178)。
// note の画面に入れる工程は持たない(入れるのは拡張の content script)。ここでは
//   - 拡張をビルドする
//   - 拡張を読み込んだ Chromium を、ログインの状態(.profile/)のまま開く
//   - 拡張の設定(chrome.storage)を、この実行のあいだだけ変えて、終わったら戻す
//   - 拡張のバナーが終わるのを待って、中身を読む
// だけを行う。クリックは tools/draft.ts の safeClick を通す(このファイルでは押さず、押す関数を受け取る)。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { matchesAnyText } from "../../shared/text-match.js";
import { DEFAULT_SELECTORS_URL } from "../../shared/selectors-url.js";
import { validateSelectorsJson } from "../../shared/selectors-schema.js";
import { PROFILE_DIR } from "./browser.js";

/** 押す関数(tools/draft.ts の safeClick。禁止の文字の検査を通してから押す) */
export type Click = (locator: Locator, context: string) => Promise<void>;

/** ボタンになりうる要素 */
const BUTTONS = 'button, [role="button"]';

export const EXTENSION_DIR = path.resolve(process.cwd(), "extension");
export const EXTENSION_DIST = path.join(EXTENSION_DIR, "dist");
/** 手元の selectors/note.json(拡張が GitHub から読む代わりに、これを渡す) */
const LOCAL_SELECTORS = path.resolve(process.cwd(), "selectors/note.json");

/**
 * 拡張をビルドする(毎回。手元の拡張のコードと同じ動きにするため)。
 * 開発用のビルド(EXTRA_SITE=1)にはしない。失敗したら投げる
 */
export function buildExtension(): void {
  if (!existsSync(path.join(EXTENSION_DIR, "node_modules"))) {
    throw new Error("拡張の依存が入っていません。先に `cd extension && npm ci` を実行してください。");
  }
  const env = { ...process.env };
  delete env.EXTRA_SITE;
  const r = spawnSync("npm", ["run", "build"], { cwd: EXTENSION_DIR, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`拡張のビルドに失敗しました。\n${r.stdout ?? ""}${r.stderr ?? ""}`);
  if (!existsSync(path.join(EXTENSION_DIST, "manifest.json"))) throw new Error("拡張のビルドが dist/manifest.json を作りませんでした。");
}

/**
 * 拡張を読み込んだ Chromium を、ログインの状態(.profile/)のまま開く。headless にはしない(人が最後に公開ボタンを押す前提のため)。
 * Google Chrome(channel: "chrome")はコマンドから拡張を読み込めないので、Playwright の Chromium を使う
 */
export async function launchWithExtension(
  opts: { profileDir?: string; headless?: boolean; executablePath?: string; args?: string[] } = {},
): Promise<{ ctx: BrowserContext; extensionId: string }> {
  if (process.env.PIGEON_BROWSER_CHANNEL) {
    console.warn("PIGEON_BROWSER_CHANNEL は使いません(拡張を読み込むため、Playwright の Chromium で開きます)。");
  }
  // 拡張の service worker が出す通信(セレクタの取得)も、下の route で差し替えられるようにする
  process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
  // opts はテスト(shared/playwright-driver.dom.test.ts)のためのもの。ふだんは .profile/ を使い、画面を出す
  const ctx = await chromium.launchPersistentContext(opts.profileDir ?? PROFILE_DIR, {
    headless: opts.headless ?? false,
    // 拡張を読み込めるのは Chromium の本体だけ(画面を出さないときの既定の軽い版は、拡張を読み込めない)。
    // shared/extension-e2e.dom.test.ts と同じく、実行ファイルを指定しないときは channel: "chromium" にする
    ...(opts.executablePath ? { executablePath: opts.executablePath } : { channel: "chromium" }),
    viewport: { width: 1280, height: 900 },
    locale: "ja-JP",
    // 自動操作の検知を外す指定(--disable-blink-features=AutomationControlled)は入れない(tools/lib/browser.ts と同じ理由)
    args: [`--disable-extensions-except=${EXTENSION_DIST}`, `--load-extension=${EXTENSION_DIST}`, ...(opts.args ?? [])],
  });
  // 拡張は main の selectors/note.json を読みに行く。Playwright 版は今までどおり手元のファイルを使う
  // (セレクタを直して試すとき、push しなくても効くように)。中身は拡張と同じ検査を通してから渡す
  const local = JSON.stringify(validateSelectorsJson(JSON.parse(readFileSync(LOCAL_SELECTORS, "utf8"))));
  await ctx.route(DEFAULT_SELECTORS_URL, (route) => route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: local }));
  const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15_000 }));
  return { ctx, extensionId: new URL(worker.url()).host };
}

/** 拡張のポップアップを、ふつうのタブで開く */
export async function openPopup(ctx: BrowserContext, extensionId: string): Promise<Page> {
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  return popup;
}

type StorageValues = Record<string, unknown>;

/**
 * 拡張の設定(chrome.storage.local)を、この実行のあいだだけ変える。戻すための関数を返す。
 * 値が undefined のものは消す。キーの名前は extension/src/lib/types.ts の STORAGE と同じ
 */
export async function overrideExtensionStorage(popup: Page, values: StorageValues): Promise<() => Promise<void>> {
  const keys = Object.keys(values);
  const before = await popup.evaluate(async (keys) => {
    const c = (globalThis as unknown as { chrome: ChromeStorage }).chrome;
    return await c.storage.local.get(keys);
  }, keys);
  await writeStorage(popup, values);
  return async () => {
    const restore: StorageValues = {};
    for (const k of keys) restore[k] = before[k];
    await writeStorage(popup, restore);
  };
}

/** 拡張のセレクタのキャッシュを消す(手元の selectors/note.json を読ませるため。戻さない) */
export async function clearSelectorsCache(popup: Page): Promise<void> {
  await writeStorage(popup, { [SELECTORS_CACHE_KEY]: undefined });
}
/** extension/src/lib/types.ts の STORAGE.selectorsCache */
const SELECTORS_CACHE_KEY = "selectorsCache";

type ChromeStorage = {
  storage: { local: { get: (k: string[]) => Promise<StorageValues>; set: (v: StorageValues) => Promise<void>; remove: (k: string[]) => Promise<void> } };
};

async function writeStorage(page: Page, values: StorageValues): Promise<void> {
  await page.evaluate(async (values) => {
    const c = (globalThis as unknown as { chrome: ChromeStorage }).chrome;
    const set: StorageValues = {};
    const remove: string[] = [];
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) remove.push(k);
      else set[k] = v;
    }
    if (Object.keys(set).length) await c.storage.local.set(set);
    if (remove.length) await c.storage.local.remove(remove);
  }, values);
}

/** 拡張のバナーの状態(extension/src/lib/content/banner.ts の data-state)。working のあいだは入れている途中 */
export type BannerState = "working" | "info" | "ok" | "warn" | "error";
export type BannerResult = { state: BannerState; text: string };

/** バナーの今の状態と文(見える部分と「詳細」)。まだ出ていなければ null */
export async function readBanner(page: Page): Promise<BannerResult | null> {
  return page
    .evaluate(() => {
      const host = document.getElementById("lastclick-pigeon-banner");
      if (!host?.shadowRoot) return null;
      const root = host.shadowRoot;
      const text = [root.getElementById("sum")?.textContent ?? "", root.getElementById("det")?.textContent ?? ""].filter(Boolean).join("\n\n");
      return { state: (host.dataset.state ?? "working") as BannerState, text };
    })
    .catch(() => null);
}

/**
 * 拡張のバナーが、入れている途中(working)でなくなるまで待つ。changedFrom を渡すと、その文から変わるまでも待つ
 * (ボタンを押した直後に、前の結果を読んでしまわないように)。時間内に終わらなければ投げる
 */
export async function waitBannerDone(page: Page, timeoutMs: number, changedFrom?: string): Promise<BannerResult> {
  const end = Date.now() + timeoutMs;
  let last: BannerResult | null = null;
  for (;;) {
    last = await readBanner(page);
    if (last && last.state !== "working" && (changedFrom === undefined || last.text !== changedFrom)) return last;
    if (Date.now() > end) {
      throw new Error(`拡張の入力が ${Math.round(timeoutMs / 1000)} 秒たっても終わりませんでした。バナー: ${last?.text.replace(/\s+/g, " ").slice(0, 200) ?? "(出ていない)"}`);
    }
    if (page.isClosed()) throw new Error("note のタブが閉じられました。");
    await page.waitForTimeout(500);
  }
}

/** バナーの結果に、失敗した工程(✗)があるか */
export function bannerFailed(r: BannerResult): boolean {
  return r.state === "error" || r.text.includes("✗");
}

/**
 * ポップアップの「GitHub から読み込む」に URL を入れて読み込み、下書きを作るボタンを押す。開いた note のタブを返す。
 * 読み込めない・記事が 2 本以上ある PR・入れる先と合わない(target)などは、ポップアップの知らせの文で投げる
 */
export async function submitFromPopup(popup: Page, url: string, click: Click): Promise<Page> {
  console.log(`記事を読み込んでいます: ${url}`);
  // 「GitHub から読み込む」は「拡張機能の設定」の中(たたんである)にあるので、外側から開いておく(押さずに open にするだけ)
  await popup.evaluate(() => {
    for (let e: HTMLElement | null = document.getElementById("github-url"); e; e = e.parentElement) {
      if (e instanceof HTMLDetailsElement) e.open = true;
    }
  });
  await popup.locator("#github-url").fill(url);
  await click(popup.locator("#github-load"), "draft.githubLoad");
  // 読み込み中の知らせが、結果の知らせ(読み込みました・エラー・記事を選ぶ)に変わるまで待つ。
  // 読み込んだ記事の target が入れる先と合わないときは、知らせが下書きを作るボタンの下(#status)に移る
  await popup.waitForFunction(
    // 中に名前付きの関数を作らない(tsx の keepNames が入れる __name がページ側に無いため)
    () => {
      const g = document.getElementById("status-github");
      const github = g && !g.hidden ? (g.textContent ?? "") : "";
      const s = document.getElementById("status");
      const submit = s && !s.hidden ? (s.textContent ?? "") : "";
      return (github !== "" && !/取得中|探しています/.test(github)) || submit !== "";
    },
    null,
    { timeout: 120_000 },
  );
  const status = popup.locator("#status-github");
  const message = ((await status.textContent()) ?? "").trim();
  if ((await status.isVisible()) && (await status.evaluate((el) => el.classList.contains("error")))) throw new Error(`記事を読み込めませんでした: ${message}`);
  if (await popup.locator("#github-pick").isVisible()) {
    const labels = await popup.locator("#github-article option").allTextContents();
    throw new Error(`この PR には記事が ${labels.length} 本あります。読み込む記事のフォルダの URL を渡してください: ${labels.join(", ")}`);
  }
  console.log(`  title    : ${await popup.locator("#title").inputValue()}`);
  console.log(`  hashtags : ${(await popup.locator("#hashtags").inputValue()) || "(なし)"}`);
  console.log(`  magazine : ${(await popup.locator("#magazine").inputValue()) || "(なし)"}`);
  console.log(`  price    : ${(await popup.locator("#price").inputValue()) || "(なし。無料)"}`);
  const submit = popup.locator("#submit");
  if (await submit.isDisabled()) {
    throw new Error(`下書きを作れません: ${((await popup.locator("#status").textContent()) ?? "").trim() || "(ポップアップに理由が出ていません)"}`);
  }
  // 拡張は新しいタブで note のエディタを開く(書き換えの表示は、ポップアップの今のタブが note の記事のときだけなので、ここでは出ない)
  const opened = popup.context().waitForEvent("page", { timeout: 60_000 });
  await click(submit, "draft.submit");
  const editor = await opened.catch(async () => {
    throw new Error(`note のタブが開きませんでした: ${((await popup.locator("#status").textContent()) ?? "").trim()}`);
  });
  // ポップアップは、タブを開いたあとで「どのタブに入れるか」を記録する。記録し終える(「note を開きました」が出る)前に
  // ポップアップを閉じると、note のタブの拡張が自分向けの記事だと分からず、何も入れない
  await popup
    .waitForFunction(() => /note を開きました/.test(document.getElementById("status")?.textContent ?? "") || !!document.querySelector("#status.error"), null, {
      timeout: 30_000,
    })
    .catch(() => {});
  const after = ((await popup.locator("#status").textContent()) ?? "").trim();
  if (!/note を開きました/.test(after)) throw new Error(`拡張が note のタブに記事を渡せませんでした: ${after || "(ポップアップに知らせが出ていません)"}`);
  return editor;
}

/** 拡張のバナーの中のボタン(文字で探す。拡張と同じ一致判定) */
export async function bannerButton(page: Page, text: string): Promise<Locator> {
  const buttons = page.locator("#lastclick-pigeon-banner button[data-action]");
  const labels = await buttons.allTextContents();
  const i = labels.findIndex((l) => matchesAnyText([l], [text]));
  if (i < 0) throw new Error(`拡張のバナーに「${text}」のボタンがありません(あるもの: ${labels.join(" / ") || "なし"})。`);
  return buttons.nth(i);
}

/**
 * base に当たる要素のうち、文字が候補に一致するものに印(属性 mark)を付ける。一致の判定は拡張と同じ
 * (shared/text-match.ts の matchesAnyText: 表示文字か aria-label を正規化して完全一致。「保存」は「下書き保存」に当たらない)。
 * Playwright の `button:text-is("…")` は、文字がボタンの中の <span> などに入っていると当たらない(実機の note のボタンはこの形)
 */
async function markByText(page: Page, base: string, texts: readonly string[], mark: string): Promise<void> {
  const all = page.locator(base);
  const labels = await all.evaluateAll((els) => els.map((e) => [e.textContent, e.getAttribute("aria-label")] as const));
  const hits = labels.flatMap((l, i) => (matchesAnyText(l, texts) ? [i] : []));
  await all.evaluateAll(
    (els, [hits, mark]) => els.forEach((e, i) => (hits.includes(i) ? e.setAttribute(mark, "1") : e.removeAttribute(mark))),
    [hits, mark] as const,
  );
}

/** base に当たり文字が候補に一致する、見えている要素が出るまで待つ。出なければ null */
async function waitByText(page: Page, base: string, texts: readonly string[], mark: string, timeout: number): Promise<Locator | null> {
  const end = Date.now() + timeout;
  for (;;) {
    await markByText(page, base, texts, mark);
    const el = page.locator(`[${mark}]`).filter({ visible: true }).first();
    if (await el.count()) return el;
    if (Date.now() > end) return null;
    await page.waitForTimeout(500);
  }
}

/** 見えているボタンの文字の一覧(見つからなかったときの手がかり。押しはしない) */
async function visibleButtonTexts(page: Page): Promise<string> {
  const texts = await page
    .locator(BUTTONS)
    .filter({ visible: true })
    .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim().slice(0, 20) || `(${e.getAttribute("aria-label") ?? "文字なし"})`))
    .catch(() => [] as string[]);
  return texts.slice(0, 30).join(" / ") || "なし";
}

/** 「下書き保存」を押して、保存が終わるのを待つ。押すのはこのボタンだけ(公開ボタンには触らない) */
export async function saveDraft(page: Page, click: Click) {
  // 拡張と同じ一致判定で探し、見えているものを押す(同じ文字のボタンが隠れて複数あることがある)
  const button = await waitByText(page, BUTTONS, ["下書き保存"], "data-lastclick-save", 15_000);
  if (!button) throw new Error(`「下書き保存」のボタンが見つかりません。見えているボタン: ${await visibleButtonTexts(page)}`);
  // 押したあとに note の API へ送られる保存の通信(GET 以外)を待ち、成功したことを確かめる。
  // 確かめられなければ失敗にする(見張り役が「保存できた」と記録して、やり直さなくなるのを防ぐ)
  const saved = page.waitForResponse((r) => r.request().method() !== "GET" && /^https:\/\/([a-z0-9-]+\.)?note\.com\/api\//.test(r.url()), {
    timeout: 15_000,
  });
  await click(button, "saveDraft");
  const res = await saved.catch(() => {
    throw new Error("下書き保存の通信が 15 秒以内に返ってきませんでした。");
  });
  if (!res.ok()) throw new Error(`下書き保存に失敗しました(HTTP ${res.status()})。`);
  // 見張り役から動かしたときは、保存が済んだ印を残す(このあと止まっても、同じ記事を作り直さないため)
  const marker = process.env.LOC_SAVED_MARKER;
  if (marker) {
    mkdirSync(path.dirname(marker), { recursive: true });
    writeFileSync(marker, `${new Date().toISOString()} ${page.url()}\n`);
  }
  // 続く通信(画像など)が落ち着くのを少し待ってから閉じる
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

