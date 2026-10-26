import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const env = {
  ...process.env,
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "",
  LANGSMITH_TRACING: "false",
};

function cli(...args: string[]) {
  return exec(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    env,
    timeout: 15_000,
  });
}

test("CLI demo runs without credentials and shows revision and approval", async () => {
  const { stdout } = await cli("--demo", "设计任务系统");
  assert.match(stdout, /离线演示/);
  assert.match(stdout, /planner/);
  assert.match(stdout, /reviewer/);
  assert.match(stdout, /approved/);
  assert.match(stdout, /执行次数：2/);
  assert.match(stdout, /设计任务系统/);
});

test("CLI returns exit code 2 for an unapproved result at the limit", async () => {
  await assert.rejects(
    cli("--demo", "--max-attempts", "1", "目标"),
    (error: Error & { code?: number; stdout?: string }) =>
      error.code === 2 && Boolean(error.stdout?.includes("revision_limit")),
  );
});

test("help works without credentials", async () => {
  const { stdout } = await cli("--help");
  assert.match(stdout, /--max-attempts/);
});

test("live mode fails clearly without configuration", async () => {
  await assert.rejects(
    cli("目标"),
    (error: Error & { code?: number; stderr?: string }) =>
      error.code === 1 && Boolean(error.stderr?.includes("OPENAI_API_KEY")),
  );
});

test("invalid limits and missing goals are rejected", async () => {
  await assert.rejects(
    cli("--demo", "--max-attempts", "oops"),
    (error: Error & { code?: number; stderr?: string }) =>
      error.code === 1 &&
      Boolean(error.stderr?.includes("--max-attempts 必须")),
  );
  await assert.rejects(
    cli(),
    (error: Error & { code?: number; stderr?: string }) =>
      error.code === 1 && Boolean(error.stderr?.includes("非空目标")),
  );
});
