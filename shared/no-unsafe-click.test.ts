import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const allowed = "extension/src/lib/safe-click.ts";

// 安全側に倒し、コメントや文字列中の例も検出する。テスト用の例は *.test.ts に置く。
function unsafeOperations(source: string): string[] {
  const patterns = [
    /(?:\?\.|\.)\s*dispatchEvent\s*\(\s*["'`]click["'`]/g,
    /(?:\?\.|\.)\s*(?:click|dblclick|tap|check|uncheck|setChecked|submit|requestSubmit)\s*(?:\?\.)?\s*\(/g,
    /\[\s*["'`](?:click|dblclick|tap|check|uncheck|setChecked|submit|requestSubmit)["'`]\s*\]\s*(?:\?\.)?\s*\(/g,
    /\bnew\s+(?:(?:window|globalThis)\s*\.\s*)?(?:MouseEvent|PointerEvent)\s*\(\s*["'`]click["'`]/g,
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => {
    const line = source.slice(0, match.index).split("\n").length;
    return `${line}: ${match[0]}`;
  }));
}

// トップレベルの関数だけを許可する。終端を特定できなければ除外せず失敗させる。
function functionRange(source: string, name: string): [number, number] {
  const declarations = [...source.matchAll(new RegExp(`^async function ${name}\\(`, "gm"))];
  assert.equal(declarations.length, 1, `${name} は 1 つだけ必要です`);
  const start = declarations[0].index!;
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1, `${name} の終端が必要です`);
  const body = source.slice(start, end + 2);
  assert.equal((body.match(/^async function /gm) ?? []).length, 1);
  return [start, end + 2];
}

function outsideSafeClick(source: string): string {
  const [start, end] = functionRange(source, "safeClick");
  const body = source.slice(start, end);
  assert.deepEqual(unsafeOperations(body).map((hit) => hit.replace(/^\d+: /, "")), [".click("]);
  assert.equal((body.match(/\blocator\.click\(\)/g) ?? []).length, 1);
  // 行番号を維持する。
  return source.slice(0, start) + body.replace(/[^\n]/g, " ") + source.slice(end);
}

// press(key) のほか、page.press(selector, key) / frame.press(selector, key) のようにキーが第 2 引数の形も数える。
// 第 1 引数は文字列か、変数・プロパティ(a.b、a[0] など)だけを読み飛ばす
const PRESS_FIRST_ARG = String.raw`(?:\s*(?:"[^"\n]*"|'[^'\n]*'|\`[^\`\n]*\`|[\w$.\[\]]+)\s*,)?`;
const ENTER = new RegExp(
  String.raw`(?:\bpress\s*(?:\?\.)?\s*|\[\s*["'\`]press["'\`]\s*\]\s*(?:\?\.)?\s*)\(` + PRESS_FIRST_ARG + String.raw`\s*["'\`]Enter["'\`]`,
  "g",
);

function enterOperations(source: string): RegExpMatchArray[] {
  return [...source.matchAll(ENTER)];
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path] : [];
  });
}

describe("safeClick を迂回する操作の検査", () => {
  it("拡張・共通コード・Playwright 版の全 TypeScript ファイルを再帰的に検査する", () => {
    const files = ["extension/src", "shared", "tools"].flatMap((dir) => sourceFiles(join(root, dir)));
    assert.ok(files.length > 0);
    const violations = files.flatMap((path) => {
      const name = relative(root, path).replaceAll("\\", "/");
      if (name === allowed) return [];
      const source = readFileSync(path, "utf8");
      return unsafeOperations(name === "tools/draft.ts" ? outsideSafeClick(source) : source).map((hit) => `${name}:${hit}`);
    });
    assert.deepEqual(violations, [], `safeClick を通らない操作があります:\n${violations.join("\n")}`);
  });

  it("tools の Enter は fillPublishSettings のタグ入力 1 か所だけ許可する", () => {
    const hits = sourceFiles(join(root, "tools")).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return enterOperations(source).map((hit) => {
        assert.equal(relative(root, path), "tools/draft.ts");
        const [start, end] = functionRange(source, "fillPublishSettings");
        assert.ok(hit.index! >= start && hit.index! < end);
        assert.ok(source.slice(0, hit.index).endsWith("tagInput."));
        return hit;
      });
    });
    assert.equal(hits.length, 1);
  });

  it("safeClick の外側は除外せず、関数内の追加クリックも拒否する", () => {
    const safe = 'async function safeClick() {\n  await locator.click();\n}';
    assert.equal(unsafeOperations(outsideSafeClick(safe + '\nbutton.click();')).length, 1);
    assert.throws(() => outsideSafeClick(safe.replace('await locator.click();', 'await locator.click(); button.click();')));
    assert.throws(() => outsideSafeClick(safe.replace('await locator.click();', 'await locator.click(); await box.setChecked(true);')));
    assert.throws(() => outsideSafeClick(safe.replace('await locator.click();', 'await locator.click(); await box.uncheck();')));
  });

  it("Enter の表記揺れも数え、Escape は数えない", () => {
    assert.equal(enterOperations(`input.press('Enter'); page.keyboard.press("Enter"); input["press"]("Enter");`).length, 3);
    assert.equal(enterOperations('page.keyboard.press("Escape")').length, 0);
    // セレクタを第 1 引数に取る形(page.press / frame.press)
    assert.equal(enterOperations(`await page.press('button[type=submit]', 'Enter'); frame.press(sel, "Enter"); page["press"]("#publish", \`Enter\`);`).length, 3);
    assert.equal(enterOperations(`page.press("#tag", "Escape")`).length, 0);
  });

  for (const source of [
    "page.mouse.click(0, 0)", "locator.dblclick()", "locator.tap()", "locator.check()",
    "checkbox.setChecked(true)", "checkbox.uncheck()", "box['setChecked'](false)", "box[\"uncheck\"]()",
    'locator.dispatchEvent("click")', "locator['tap']()",
    "el.click()", "el . click ( )", "el?.click?.()", "el['click']()",
    "form.submit()", "form.requestSubmit(button)", "form[\"requestSubmit\"]()",
    'new MouseEvent("click", {})', "new PointerEvent('click')",
    'new\nMouseEvent(\n"click")', 'new window.MouseEvent("click")',
  ]) {
    it(`検出: ${source}`, () => assert.notEqual(unsafeOperations(source).length, 0));
  }

  it("safeClick 呼び出しや click 以外のイベントは許可する", () => {
    assert.deepEqual(unsafeOperations('safeClick(el); new MouseEvent("mouseover");'), []);
  });
});
