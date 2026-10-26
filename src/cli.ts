import { parseArgs } from "node:util";
import { createDemoAgents } from "./agents/demo.js";
import { createOpenAIAgents } from "./agents/model.js";
import { loadModelConfig } from "./config.js";
import { GoalSchema, MaxAttemptsSchema } from "./contracts.js";
import { createAgentGraph, type WorkflowResult } from "./graph.js";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      demo: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
      "max-attempts": { type: "string", default: "3" },
    },
  });
  if (values.help) {
    console.log(`用法：npm run dev -- [--demo] [--max-attempts 1..5] "任务目标"
离线演示：npm run demo -- "设计一个任务管理系统"
真实模型：在 .env 中配置 OPENAI_API_KEY、OPENAI_MODEL 和可选的 OPENAI_BASE_URL。
退出码：0 审核通过；1 输入、配置或运行错误；2 已达执行次数上限但未通过审核。`);
    return;
  }

  const parsedGoal = GoalSchema.safeParse(
    positionals.join(" ") || (values.demo ? "设计一个任务管理系统" : ""),
  );
  if (!parsedGoal.success)
    throw new Error("请提供 1–20000 字的非空目标，使用 --help 查看用法。");
  const parsedLimit = MaxAttemptsSchema.safeParse(
    Number(values["max-attempts"]),
  );
  if (!parsedLimit.success)
    throw new Error("--max-attempts 必须是 1–5 之间的整数（包含首次执行）。");

  const agents = values.demo
    ? createDemoAgents()
    : createOpenAIAgents(loadModelConfig());
  const graph = createAgentGraph(agents, { maxAttempts: parsedLimit.data });
  console.log(
    values.demo
      ? "离线演示：模拟角色输出，运行真实 LangGraph 流程。"
      : "模型模式：开始执行。",
  );
  let result: WorkflowResult | undefined;
  const stream = await graph.stream(
    { goal: parsedGoal.data },
    { streamMode: ["updates", "values"] },
  );
  for await (const [mode, event] of stream) {
    if (mode === "values") {
      result = event;
    } else {
      for (const node of Object.keys(event)) console.log(`[${node}] 已完成`);
    }
  }

  if (!result || result.status === "running")
    throw new Error("流程结束但没有最终结论。");
  console.log(
    `\n状态：${result.status}\n执行次数：${result.attempts}\n审核：${result.feedback}\n\n${result.draft}`,
  );
  if (result.status === "revision_limit") process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(
    `执行失败：${error instanceof Error ? error.message : "未知错误"}`,
  );
  process.exitCode = 1;
});
