import type { Agents } from "../contracts.js";

/** Deterministic fixtures for exploring the real graph without model requests. */
export function createDemoAgents(): Agents {
  return {
    plan: async () => ({
      steps: ["明确目标和范围", "给出实施建议", "补充验收标准"],
    }),
    execute: async ({ goal, feedback }) => ({
      draft: feedback
        ? `【离线演示·修订稿】\n目标：${goal}\n建议：先界定范围，再分步实施。\n验收标准：逐项核对目标、成果与遗漏。\n已处理反馈：${feedback}\n（以上是模拟文本，不是模型生成的实际方案。）`
        : `【离线演示·初稿】\n目标：${goal}\n建议：先界定范围，再分步实施。\n（模拟初稿，故意缺少验收标准。）`,
    }),
    review: async ({ draft }) =>
      draft.startsWith("【离线演示·修订稿】")
        ? { approved: true, feedback: "演示审核通过：已补充验收标准。" }
        : { approved: false, feedback: "请补充可检查的验收标准。" },
  };
}
