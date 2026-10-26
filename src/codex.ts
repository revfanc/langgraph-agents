import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  type AgentRequest,
  CodeResultSchema,
  type CodingAgent,
  ReviewResultSchema,
} from "./domain.js";
import { runProcess } from "./process.js";
import type { Store } from "./storage.js";

// Official non-interactive JSONL protocol: https://learn.chatgpt.com/docs/non-interactive-mode
export function createCodexAgent(
  store: Store,
  options: {
    executable?: string;
    execute?: typeof runProcess;
  } = {},
): CodingAgent {
  async function invoke<T>(
    role: "code" | "review",
    request: AgentRequest,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const { run, attempt, signal, prompt } = request;
    signal.throwIfAborted();
    const latest = store.run(run.id);
    if (latest.agentCalls >= latest.maxAgentCalls)
      throw new Error("已达 agent 调用预算，保留现场以供人工检查。");
    const call = latest.agentCalls + 1;
    store.updateRun(run.id, { agentCalls: call });
    const sessionKey =
      role === "code" ? "coding-session" : `review-session:${attempt}`;
    const session = store.receipt(run.id, sessionKey, z.string());
    const schemaPath = store.artifact(
      run.id,
      `${role}.schema.json`,
      JSON.stringify(z.toJSONSchema(schema)),
    );
    const output = join(store.dir(run.id), `${role}-${call}.reply.json`);
    writeFileSync(output, "", "utf8");
    const args = [
      "exec",
      "--ignore-user-config",
      "--json",
      "--color",
      "never",
      "--sandbox",
      role === "code" ? "workspace-write" : "read-only",
      "-c",
      'approval_policy="never"',
      "-c",
      "sandbox_workspace_write.network_access=false",
      "-c",
      'web_search="disabled"',
      "--cd",
      run.worktree,
    ];
    // Ignoring user config must not discard the native Windows sandbox backend.
    // This selects OS enforcement; it does not grant administrator access to tools.
    if (process.platform === "win32")
      args.push("-c", 'windows.sandbox="elevated"');
    if (run.project.model) args.push("--model", run.project.model);
    if (session) args.push("resume", session, "--ignore-user-config", "--json");
    args.push(
      "--output-schema",
      schemaPath,
      "--output-last-message",
      output,
      "-",
    );
    let completed = false;
    let failed = false;
    const result = await (options.execute ?? runProcess)({
      command: options.executable ?? process.env.CODEX_BIN ?? "codex",
      args,
      cwd: run.worktree,
      input: prompt,
      signal,
      timeoutMs: run.agentTimeoutMs,
      log: join(store.dir(run.id), `${role}-${call}.jsonl.log`),
      onStart: (childPid) => {
        store.updateRun(run.id, { childPid });
      },
      onExit: () => {
        store.updateRun(run.id, { childPid: undefined });
      },
      onLine: (line) => {
        if (!line.trim()) return;
        const event = z
          .object({ type: z.string() })
          .passthrough()
          .parse(JSON.parse(line));
        if (event.type === "thread.started")
          store.saveReceipt(
            run.id,
            sessionKey,
            z.string().parse(event.thread_id),
          );
        if (event.type === "turn.completed") {
          completed = true;
          store.saveReceipt(run.id, `usage:${call}`, event.usage ?? {});
        }
        if (event.type === "turn.failed") failed = true;
      },
    });
    signal.throwIfAborted();
    if (!result.passed || !completed || failed) {
      throw new Error(
        `Codex ${role} 未完成 (${result.reason}, exit=${result.exitCode})。日志：${result.log}\n${result.tail.slice(-3000)}`,
      );
    }
    return schema.parse(JSON.parse(readFileSync(output, "utf8")));
  }
  return {
    code: (request) => invoke("code", request, CodeResultSchema),
    review: (request) => invoke("review", request, ReviewResultSchema),
  };
}
