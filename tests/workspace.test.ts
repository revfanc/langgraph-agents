import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/storage.js";
import {
  createRun,
  inside,
  prepareWorkspace,
  registerProject,
  snapshot,
} from "../src/workspace.js";

test("tasks use a committed snapshot in their own worktree and retain untracked files in diff", async () => {
  const root = mkdtempSync(join(tmpdir(), "orchestrator-repo-"));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "config", "core.autocrlf", "false"]);
  writeFileSync(join(repo, "a.txt"), "original\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "init",
  ]);
  const store = new Store(join(root, "data"));
  try {
    await registerProject(store, "one", repo, {
      checks: [{ name: "test", command: "node", args: ["--version"] }],
    });
    const run = createRun(store, "one", "change file");
    prepareWorkspace(run);
    prepareWorkspace(run);
    writeFileSync(join(run.worktree, "a.txt"), "changed\n");
    writeFileSync(join(run.worktree, "new.txt"), "new\n");
    const result = snapshot(run);
    assert.match(result.diff, /changed/);
    assert.match(result.diff, /new.txt/);
    assert.equal(readFileSync(join(repo, "a.txt"), "utf8"), "original\n");
    writeFileSync(join(repo, "a.txt"), "user edits\n");
    assert.throws(() => createRun(store, "one", "another task"), /未提交/);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("project-relative paths cannot escape the worktree", () => {
  assert.throws(() => inside(process.cwd(), "../outside"));
  assert.throws(() => inside(process.cwd(), join(process.cwd(), "outside")));
});
