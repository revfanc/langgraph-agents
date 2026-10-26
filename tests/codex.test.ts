import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
import { createCodexAgent } from "../src/codex.js";
import { fixture } from "./helpers.js";

test("Codex uses bounded permissions, saves its session and resumes it for repair", async () => {
  const f = await fixture();
  let calls = 0;
  try {
    const agent = createCodexAgent(f.store, {
      execute: async (options) => {
        calls++;
        assert.ok(options.args.includes("workspace-write"));
        assert.ok(options.args.includes('approval_policy="never"'));
        if (process.platform === "win32")
          assert.ok(options.args.includes('windows.sandbox="elevated"'));
        assert.ok(!options.args.some((arg) => arg.includes("dangerously")));
        if (calls === 2) assert.ok(options.args.includes("resume"));
        options.onLine?.(
          JSON.stringify({ type: "thread.started", thread_id: "session-one" }),
        );
        options.onLine?.(
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        );
        const output =
          options.args[options.args.indexOf("--output-last-message") + 1];
        assert.ok(output);
        writeFileSync(
          output,
          JSON.stringify({ outcome: "completed", summary: "changed" }),
        );
        return {
          passed: true,
          exitCode: 0,
          reason: "exit",
          tail: "",
          log: options.log,
        };
      },
    });
    const request = {
      run: f.run,
      attempt: 1,
      prompt: "fix",
      signal: new AbortController().signal,
    };
    await agent.code(request);
    await agent.code({ ...request, attempt: 2 });
    assert.equal(f.store.run(f.run.id).agentCalls, 2);
    f.store.updateRun(f.run.id, { maxAgentCalls: 2 });
    await assert.rejects(agent.code(request), /调用预算/);
    assert.equal(calls, 2);
  } finally {
    f.cleanup();
  }
});

test("a successful process exit without a completed agent turn is an error", async () => {
  const f = await fixture();
  try {
    const agent = createCodexAgent(f.store, {
      execute: async (options) => ({
        passed: true,
        exitCode: 0,
        reason: "exit",
        tail: "",
        log: options.log,
      }),
    });
    await assert.rejects(
      agent.code({
        run: f.run,
        attempt: 1,
        prompt: "fix",
        signal: new AbortController().signal,
      }),
      /未完成/,
    );
  } finally {
    f.cleanup();
  }
});
