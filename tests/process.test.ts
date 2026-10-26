import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runProcess } from "../src/process.js";

test("command runner preserves arguments and captures failure evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "orchestrator-process-"));
  try {
    const result = await runProcess({
      command: process.execPath,
      args: [
        "-e",
        "console.log(process.argv[1]); process.exitCode=7",
        "hello & echo unsafe",
      ],
      cwd: root,
      log: join(root, "check.log"),
      timeoutMs: 5000,
    });
    assert.equal(result.exitCode, 7);
    assert.match(result.tail, /hello & echo unsafe/);
    assert.match(
      readFileSync(join(root, "check.log"), "utf8"),
      /hello & echo unsafe/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("timeout terminates a running command and is never a pass", async () => {
  const root = mkdtempSync(join(tmpdir(), "orchestrator-timeout-"));
  try {
    const result = await runProcess({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{}, 1000)"],
      cwd: root,
      log: join(root, "check.log"),
      timeoutMs: 200,
    });
    assert.equal(result.reason, "timeout");
    assert.equal(result.passed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("output limits terminate a noisy process and bound its log", async () => {
  const root = mkdtempSync(join(tmpdir(), "orchestrator-output-"));
  try {
    const result = await runProcess({
      command: process.execPath,
      args: ["-e", "setInterval(()=>console.log('x'.repeat(4096)),1)"],
      cwd: root,
      log: join(root, "output.log"),
      timeoutMs: 5000,
      maxOutputBytes: 8192,
    });
    assert.equal(result.reason, "output_limit");
    assert.equal(result.passed, false);
    assert.ok(readFileSync(result.log).length <= 8192);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
