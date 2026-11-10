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
    /(?:\?\.|\.)\s*(?:click|submit|requestSubmit)\s*(?:\?\.)?\s*\(/g,
    /\[\s*["'`](?:click|submit|requestSubmit)["'`]\s*\]\s*(?:\?\.)?\s*\(/g,
    /\bnew\s+(?:(?:window|globalThis)\s*\.\s*)?(?:MouseEvent|PointerEvent)\s*\(\s*["'`]click["'`]/g,
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => {
    const line = source.slice(0, match.index).split("\n").length;
    return `${line}: ${match[0]}`;
  }));
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
  it("拡張と共通コードの全 TypeScript ファイルを再帰的に検査する", () => {
    const files = ["extension/src", "shared"].flatMap((dir) => sourceFiles(join(root, dir)));
    assert.ok(files.length > 0);
    const violations = files.flatMap((path) => {
      const name = relative(root, path).replaceAll("\\", "/");
      if (name === allowed) return [];
      return unsafeOperations(readFileSync(path, "utf8")).map((hit) => `${name}:${hit}`);
    });
    assert.deepEqual(violations, [], `safeClick を通らない操作があります:\n${violations.join("\n")}`);
  });

  for (const source of [
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
