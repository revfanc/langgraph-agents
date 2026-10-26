import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage.js";
import { createRun, registerProject } from "../src/workspace.js";

export async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "orchestrator-flow-"));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "config", "core.autocrlf", "false"]);
  writeFileSync(join(repo, "answer.txt"), "wrong\n");
  writeFileSync(
    join(repo, "check.mjs"),
    'import {readFileSync} from "node:fs"; if(readFileSync("answer.txt","utf8").trim()!=="42") {console.error("expected 42"); process.exitCode=1;}',
  );
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
  await registerProject(store, "sample", repo, {
    checks: [
      { name: "answer", command: process.execPath, args: ["check.mjs"] },
    ],
  });
  const run = createRun(
    store,
    "sample",
    "Set answer.txt to 42 without changing check.mjs",
  );
  return {
    root,
    repo,
    store,
    run,
    cleanup() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
