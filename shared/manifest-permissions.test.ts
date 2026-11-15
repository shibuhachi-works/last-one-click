import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const guidance = "権限を変えるときは AGENTS.md の決まりを確かめ、このテストの一覧も同じ PR で直す";
const expected = {
  permissions: ["storage", "clipboardWrite"],
  host_permissions: [
    "https://note.com/*",
    "https://editor.note.com/*",
    "https://raw.githubusercontent.com/*",
  ],
  matches: ["https://note.com/*", "https://editor.note.com/*"],
};
const forbiddenKeys = [
  "optional_permissions",
  "optional_host_permissions",
  "externally_connectable",
  "web_accessible_resources",
];

type Manifest = {
  permissions: string[];
  host_permissions: string[];
  content_scripts: { matches: string[] }[];
};

function assertPermissions(manifest: Manifest, file: string): void {
  const message = (key: string) => `${file}: ${key} が許可した一覧と異なります。${guidance}`;
  for (const key of ["permissions", "host_permissions"] as const) {
    assert.ok(Array.isArray(manifest[key]), message(key));
    assert.deepEqual([...manifest[key]].sort(), [...expected[key]].sort(), message(key));
  }

  const matchesMessage = message("content_scripts[].matches");
  assert.ok(Array.isArray(manifest.content_scripts), matchesMessage);
  const matches = manifest.content_scripts.flatMap((script) => {
    assert.ok(Array.isArray(script?.matches), matchesMessage);
    return script.matches;
  });
  assert.deepEqual(matches.sort(), [...expected.matches].sort(), matchesMessage);

  for (const key of forbiddenKeys) {
    assert.equal(Object.hasOwn(manifest, key), false, `${file}: ${key} は追加できません。${guidance}`);
  }
}

describe("拡張の権限を固定する", () => {
  for (const file of ["extension/manifest.json", "extension/dist/manifest.json"]) {
    const path = new URL(`../${file}`, import.meta.url);
    it(file, { skip: file.includes("/dist/") && !existsSync(path) }, () => {
      const manifest: Manifest = JSON.parse(readFileSync(path, "utf8"));
      assertPermissions(manifest, file);
    });
  }
});
