import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = "a".repeat(40);
const head = "b".repeat(40);
const names = ["save", "hold", "skip", "direct", "unlabelled"];
const commits = names.map((_, i) => (i + 1).toString().repeat(40));

function run(failure?: "compare" | "commit" | "pulls") {
  const cwd = mkdtempSync(path.join(tmpdir(), "watch-modes-"));
  try {
    const state = { repo: "owner/repo", branch: "main", lastSha: base, done: [] };
    writeFileSync(path.join(cwd, ".watch-state.json"), JSON.stringify(state));
    // 子プロセスの fetch と spawn を置き換え、実 API・ブラウザ・通知へは接続しない。
    writeFileSync(path.join(cwd, "mock.mjs"), `
      import cp from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { appendFileSync } from 'node:fs';
      const names = ${JSON.stringify(names)};
      const commits = ${JSON.stringify(commits)};
      const failure = ${JSON.stringify(failure ?? "")};
      const record = (entry) => appendFileSync('calls.jsonl', JSON.stringify(entry) + '\\n');
      cp.spawnSync = (cmd, args) => { record({cmd, args}); return {status: 0}; };
      syncBuiltinESMExports();
      globalThis.fetch = async (input) => {
        const url = new URL(input);
        if (url.origin !== 'https://api.github.com') throw new Error('Unexpected network request');
        const p = url.pathname;
        if (p.endsWith('/commits/main')) return Response.json({sha: '${head}'});
        if (p.includes('/compare/')) {
          if (failure === 'compare' && url.search) return new Response('', {status: 503});
          return Response.json({total_commits: commits.length, commits: commits.map(sha => ({sha})),
            files: names.map(name => ({filename: 'posts/' + name + '/article.md', status: 'added'}))});
        }
        const index = commits.findIndex(sha => p.includes(sha));
        if (index < 0) throw new Error('Unexpected API request');
        if (p.endsWith('/pulls')) {
          if (failure === 'pulls' && index === 0) return new Response('', {status: 403});
          return Response.json(index === 3 ? [] : [{number: index + 1, merged_at: '2026-01-01',
            title: 'PRIVATE_TITLE', body: 'PRIVATE_BODY',
            labels: index === 4 ? [] : [{name: 'auto-draft:' + names[index]}]}]);
        }
        if (failure === 'commit' && index === 0) return new Response('', {status: 500});
        return Response.json({files: [{filename: 'posts/' + names[index] + '/article.md', status: 'added'}]});
      };
    `);
    const result = spawnSync(process.execPath, ["--import", path.join(cwd, "mock.mjs"),
      "--import", path.join(root, "node_modules/tsx/dist/loader.mjs"), path.join(root, "tools/watch.ts")], {
      cwd, encoding: "utf8", timeout: 30_000,
      env: { PATH: "/usr/bin:/bin", LOC_WATCH_REPO: "owner/repo", LOC_WATCH_PREFIX: "posts/", LOC_WATCH_MODE: "hold" },
    });
    let calls: Array<{cmd: string; args: string[]}> = [];
    try { calls = readFileSync(path.join(cwd, "calls.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line)); } catch { /* 起動も通知も無い場合 */ }
    return { result, calls, state: JSON.parse(readFileSync(path.join(cwd, ".watch-state.json"), "utf8")) };
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

it("記事ごとに save / hold / skip を選び、PR なし・ラベルなしは既定モードにする", () => {
  const { result, calls, state } = run();
  assert.equal(result.status, 0, result.stderr);
  const drafts = calls.filter(c => c.args.includes("tools/draft.ts"));
  assert.deepEqual(drafts.map(c => c.args[2]), ["--save", "--hold", "--hold", "--hold"]);
  assert.ok(drafts.every(c => !c.args.at(-1)!.endsWith("/skip")));
  assert.equal(calls.filter(c => c.cmd === "notify-send" || c.cmd === "osascript").length, process.platform === "linux" || process.platform === "darwin" ? 1 : 0);
  assert.equal(state.lastSha, head);
  assert.deepEqual(state.done, []);
  assert.match(result.stdout, /下書きは作りません: posts\/skip/);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_TITLE|PRIVATE_BODY/);
});

for (const failure of ["compare", "commit", "pulls"] as const) {
  it(`${failure} API が失敗したら、下書きも通知も作らず処理位置を進めない`, () => {
    const { result, calls, state } = run(failure);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /GitHub API (403|500|503)/);
    assert.equal(state.lastSha, base);
    assert.deepEqual(state.done, []);
    assert.deepEqual(calls, []);
  });
}
