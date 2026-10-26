import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fixture } from "./helpers.js";

const exec = promisify(execFile);
test("CLI registers another repository and pauses before any agent request", async () => {
  const f = await fixture();
  const secondRepo = await fixture();
  const cli = (...args: string[]) =>
    exec(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "--data-dir", f.store.root, ...args],
      { timeout: 30000 },
    );
  try {
    const config = join(f.root, "project.json");
    writeFileSync(
      config,
      JSON.stringify({
        checks: [
          { name: "test", command: process.execPath, args: ["check.mjs"] },
        ],
      }),
    );
    const registered = await cli(
      "projects",
      "add",
      "second",
      "--repo",
      secondRepo.repo,
      "--config",
      config,
    );
    assert.match(registered.stdout, /second/);
    const { stdout } = await cli("projects", "list");
    assert.equal(JSON.parse(stdout).length, 2);
    assert.notEqual(
      f.store.project("sample").repo,
      f.store.project("second").repo,
    );
    await assert.rejects(
      cli("run", "second", "--task", "fix", "--pause-after", "baseline"),
      (error: Error & { code?: number; stdout?: string }) =>
        error.code === 3 && Boolean(error.stdout?.includes("status: paused")),
    );
    assert.equal(f.store.runs()[0]?.agentCalls, 0);
  } finally {
    f.cleanup();
    secondRepo.cleanup();
  }
});
