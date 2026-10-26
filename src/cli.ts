#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createCodexAgent } from "./codex.js";
import { executeRun, requestPause } from "./runner.js";
import { Store } from "./storage.js";
import { type Phase, phases } from "./workflow.js";
import { createRun, registerProject } from "./workspace.js";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      "data-dir": { type: "string" },
      repo: { type: "string" },
      config: { type: "string" },
      task: { type: "string" },
      "max-attempts": { type: "string" },
      "max-agent-calls": { type: "string" },
      "agent-timeout-ms": { type: "string" },
      "pause-after": { type: "string" },
    },
  });
  if (values.help || !positionals.length) {
    console.log(`LangGraph 本地开发编排

projects add <id> --repo <仓库绝对路径> --config <项目配置.json>
projects list                         列出已注册仓库
run <project> --task "任务"            创建隔离任务并执行
resume <run-id>                        从检查点继续
status <run-id>                        查看状态和产物位置
runs                                  列出任务
pause <run-id>                         请求正在运行的任务暂停

全局：--data-dir <目录>（默认 .orchestrator）
运行：--max-attempts 3 --max-agent-calls 10 --agent-timeout-ms 600000
阶段暂停：--pause-after prepare|baseline|code|verify|review
运行时 Ctrl+C 可暂停；恢复用 resume。任务不自动提交、合并或发布。
退出码：0 成功或查询；1 错误/blocked；2 failed；3 paused。`);
    return;
  }
  const store = new Store(resolve(values["data-dir"] ?? ".orchestrator"));
  const [command, target, id] = positionals;
  try {
    if (command === "projects" && target === "add") {
      if (!id || !values.repo || !values.config)
        throw new Error("需要项目 id、--repo 与 --config。");
      const project = await registerProject(
        store,
        id,
        values.repo,
        JSON.parse(readFileSync(values.config, "utf8")),
      );
      console.log(JSON.stringify(project, null, 2));
      return;
    }
    if (command === "projects" && target === "list") {
      console.log(JSON.stringify(store.projects(), null, 2));
      return;
    }
    if (command === "runs") {
      const runs = store.runs().map(({ id, project, task, status, phase }) => ({
        id,
        project: project.id,
        task,
        status,
        phase,
      }));
      console.log(JSON.stringify(runs, null, 2));
      return;
    }
    if (command === "status" && target) {
      console.log(
        JSON.stringify(
          { ...store.run(target), artifacts: store.dir(target) },
          null,
          2,
        ),
      );
      return;
    }
    if (command === "pause" && target) {
      requestPause(store, target);
      console.log("已请求暂停；请用 status 确认执行进程已停止。");
      return;
    }
    if ((command !== "run" && command !== "resume") || !target)
      throw new Error("未知命令，使用 --help 查看用法。");
    if (command === "run" && !values.task)
      throw new Error("请用 --task 提供明确的开发任务。");
    if (
      command === "resume" &&
      ["task", "max-attempts", "max-agent-calls", "agent-timeout-ms"].some(
        (key) => values[key as keyof typeof values] !== undefined,
      )
    )
      throw new Error(
        "resume 使用已保存的任务与预算；修改这些参数需要创建新任务。",
      );
    const pauseAfter = values["pause-after"];
    if (pauseAfter && !phases.includes(pauseAfter as Phase))
      throw new Error("无效的 --pause-after 阶段。");
    const run =
      command === "resume"
        ? store.run(target)
        : createRun(store, target, values.task ?? "", {
            maxAttempts: values["max-attempts"]
              ? Number(values["max-attempts"])
              : undefined,
            maxAgentCalls: values["max-agent-calls"]
              ? Number(values["max-agent-calls"])
              : undefined,
            agentTimeoutMs: values["agent-timeout-ms"]
              ? Number(values["agent-timeout-ms"])
              : undefined,
          });
    console.log(
      `run-id: ${run.id}\nworktree: ${run.worktree}\nartifacts: ${store.dir(run.id)}`,
    );
    const controller = new AbortController();
    const stop = () => controller.abort(new Error("用户请求暂停"));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      const result = await executeRun(store, run.id, createCodexAgent(store), {
        signal: controller.signal,
        pauseAfter: pauseAfter as Phase | undefined,
        onPhase: (phase) => console.log(`[${phase}]`),
      });
      console.log(
        `status: ${result.status}${result.error ? `\n${result.error}` : ""}`,
      );
      process.exitCode =
        result.status === "succeeded"
          ? 0
          : result.status === "paused"
            ? 3
            : result.status === "failed"
              ? 2
              : 1;
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
