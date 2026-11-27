import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { EXTRA_SITE_ENABLED, EXTRA_SITE_ORIGIN } from "./extra-site.js";

const guidance = "権限を変えるときは AGENTS.md の決まりを確かめ、このテストの一覧も同じ PR で直す";
/** 許可した権限の一覧。extension/manifest.json・ビルドした dist/manifest.json・ストアに出す ZIP で同じ */
const expected = {
  // activeTab と scripting は、入れるときの警告が出ない(追加の対応先の確かめと content script の登録に使う。v0.2.0 から)
  permissions: ["storage", "clipboardWrite", "activeTab", "scripting"],
  host_permissions: [
    "https://note.com/*",
    "https://editor.note.com/*",
    "https://raw.githubusercontent.com/*",
  ],
  matches: ["https://note.com/*", "https://editor.note.com/*"],
  // 追加の対応先。入れるときには求めず、そのサイトのページで「使えるようにする」を押したときに求める
  optional_host_permissions: [EXTRA_SITE_ORIGIN],
};
const forbiddenKeys = [
  "optional_permissions",
  "externally_connectable",
  "web_accessible_resources",
];

type Manifest = {
  version: string;
  permissions: string[];
  host_permissions: string[];
  optional_host_permissions?: string[];
  content_scripts: { matches: string[] }[];
};

function assertPermissions(manifest: Manifest, file: string): void {
  const message = (key: string) => `${file}: ${key} が許可した一覧と異なります。${guidance}`;
  for (const key of ["permissions", "host_permissions", "optional_host_permissions"] as const) {
    // optional_host_permissions は、使わないときは書かない(無い = 空)
    const value = key === "optional_host_permissions" ? (manifest[key] ?? []) : manifest[key];
    assert.ok(Array.isArray(value), message(key));
    assert.deepEqual([...value].sort(), [...expected[key]].sort(), message(key));
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
  const base = (): Manifest => JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const cases: [string, (m: Manifest) => void][] = [
    ["permissions に tabs を足す", (m) => m.permissions.push("tabs")],
    ["host_permissions に追加の対応先を足す", (m) => m.host_permissions.push("https://library.libecity.com/*")],
    ["optional_host_permissions にほかのホストを足す", (m) => (m.optional_host_permissions ??= []).push("https://example.com/*")],
    ["optional_host_permissions を広げる", (m) => (m.optional_host_permissions = ["https://*/*"])],
    ["optional_permissions を足す", (m) => Object.assign(m, { optional_permissions: ["tabs"] })],
    ["content_scripts に追加の対応先を足す", (m) => m.content_scripts[0].matches.push("https://library.libecity.com/*")],
  ];
  for (const [name, change] of cases) {
    it(`${name}と落ちる`, () => {
      const manifest = base();
      change(manifest);
      assert.throws(() => assertPermissions(manifest, "extension/manifest.json"));
    });
  }

  it("追加の対応先の入口を使う(EXTRA_SITE_ENABLED が true。v0.2.0 から)", () => {
    assert.equal(EXTRA_SITE_ENABLED, true);
  });

  for (const file of ["extension/manifest.json", "extension/dist/manifest.json"]) {
    const path = new URL(`../${file}`, import.meta.url);
    it(file, { skip: file.includes("/dist/") && !existsSync(path) }, () => {
      const manifest: Manifest = JSON.parse(readFileSync(path, "utf8"));
      assertPermissions(manifest, file);
    });
  }
});
