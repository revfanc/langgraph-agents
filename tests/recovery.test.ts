import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { CodingAgent } from "../src/domain.js";
import { executeRun, requestPause } from "../src/runner.js";
import { createRun, registerProject } from "../src/workspace.js";
import { fixture } from "./helpers.js";

const fixed: CodingAgent = {
  code: async ({ run }) => {
    writeFileSync(join(run.worktree, "answer.txt"), "42\n");
    return { outcome: "completed", summary: "fixed" };
  },
  review: async () => ({ approved: true, summary: "ok", issues: [] }),
};
const worker = (root: string, id: string, mode: string) =>
  spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./recovery-worker.ts", import.meta.url)),
      root,
      id,
      mode,
    ],
    { encoding: "utf8", timeout: 30_000, windowsHide: true },
  );

test("another process resumes a checkpoint without repeating completed coding", async () => {
  const f = await fixture();
  try {
    const paused = worker(f.store.root, f.run.id, "pause");
    assert.equal(paused.status, 0, paused.stderr);
    assert.match(paused.stdout, /paused/);
    const resumed = worker(f.store.root, f.run.id, "resume");
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.match(resumed.stdout, /succeeded/);
    assert.equal(
      readFileSync(join(f.store.root, "calls.log"), "utf8"),
      "wrong\n",
    );
  } finally {
    f.cleanup();
  }
});

test("hard crash releases stale ownership and repeats only unfinished coding against existing edits", async () => {
  const f = await fixture();
  try {
    assert.equal(worker(f.store.root, f.run.id, "crash").status, 17);
    assert.equal(
      readFileSync(join(f.run.worktree, "answer.txt"), "utf8"),
      "42\n",
    );
    const resumed = worker(f.store.root, f.run.id, "resume");
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.match(resumed.stdout, /succeeded/);
    assert.equal(
      readFileSync(join(f.store.root, "calls.log"), "utf8"),
      "wrong\n42\n",
    );
  } finally {
    f.cleanup();
  }
});

test("explicit agent blocking is recoverable without caching a false completion", async () => {
  const f = await fixture();
  try {
    const blocked = await executeRun(f.store, f.run.id, {
      ...fixed,
      code: async () => ({ outcome: "blocked", summary: "permission denied" }),
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.phase, "code:1");
    assert.match(blocked.error, /permission denied/);
    assert.equal(
      (await executeRun(f.store, f.run.id, fixed)).status,
      "succeeded",
    );
  } finally {
    f.cleanup();
  }
});

test("failed setup retries after environment repair while preserving successful setup", async () => {
  const f = await fixture();
  try {
    const count = join(f.root, "setup-count");
    const ready = join(f.root, "ready");
    await registerProject(f.store, "setup", f.repo, {
      checks: f.run.project.checks,
      setup: [
        {
          name: "once",
          command: process.execPath,
          args: [
            "-e",
            `require('node:fs').appendFileSync(${JSON.stringify(count)},'once\\n')`,
          ],
        },
        {
          name: "ready",
          command: process.execPath,
          args: [
            "-e",
            `process.exitCode=require('node:fs').existsSync(${JSON.stringify(ready)})?0:1`,
          ],
        },
      ],
    });
    const run = createRun(f.store, "setup", "fix answer");
    assert.equal((await executeRun(f.store, run.id, fixed)).status, "blocked");
    writeFileSync(ready, "ready");
    assert.equal(
      (await executeRun(f.store, run.id, fixed)).status,
      "succeeded",
    );
    assert.equal(readFileSync(count, "utf8"), "once\n");
  } finally {
    f.cleanup();
  }
});

test("pause waits for a running command to exit and resumes the interrupted setup", async () => {
  const f = await fixture();
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const ready = join(f.root, "ready");
    await registerProject(f.store, "pause", f.repo, {
      checks: f.run.project.checks,
      setup: [
        {
          name: "waiting",
          command: process.execPath,
          args: [
            "-e",
            `if(!require('node:fs').existsSync(${JSON.stringify(ready)}))setInterval(()=>{},1000)`,
          ],
        },
      ],
    });
    const run = createRun(f.store, "pause", "fix answer");
    timer = setInterval(() => {
      if (f.store.run(run.id).childPid) requestPause(f.store, run.id);
    }, 25);
    assert.equal((await executeRun(f.store, run.id, fixed)).status, "paused");
    clearInterval(timer);
    assert.equal(f.store.run(run.id).childPid, undefined);
    writeFileSync(ready, "ready");
    assert.equal(
      (await executeRun(f.store, run.id, fixed)).status,
      "succeeded",
    );
  } finally {
    clearInterval(timer);
    f.cleanup();
  }
});
