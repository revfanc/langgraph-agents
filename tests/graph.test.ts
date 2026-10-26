import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agents } from "../src/contracts.js";
import { createAgentGraph } from "../src/graph.js";

function roles(overrides: Partial<Agents> = {}): Agents {
  return {
    plan: async () => ({ steps: ["明确目标", "给出方案"] }),
    execute: async ({ goal }) => ({ draft: `成果：${goal}` }),
    review: async () => ({ approved: true, feedback: "满足要求" }),
    ...overrides,
  };
}

test("first-pass approval returns the actual plan and completed draft", async () => {
  const result = await createAgentGraph(roles()).invoke({
    goal: "设计任务系统",
  });
  assert.equal(result.status, "approved");
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.plan, ["明确目标", "给出方案"]);
  assert.equal(result.draft, "成果：设计任务系统");
});

test("revision receives the preceding draft, plan and reviewer feedback", async () => {
  const result = await createAgentGraph(
    roles({
      execute: async ({ goal, plan, draft, feedback }) => {
        assert.deepEqual(plan, ["明确目标", "给出方案"]);
        return { draft: draft ? `${draft}；${feedback}` : goal };
      },
      review: async ({ draft }) => ({
        approved: draft.includes("补充验收标准"),
        feedback: "补充验收标准",
      }),
    }),
  ).invoke({ goal: "任务系统" });
  assert.equal(result.status, "approved");
  assert.equal(result.attempts, 2);
  assert.equal(result.draft, "任务系统；补充验收标准");
});

test("exhausting attempts returns an unapproved result with feedback", async () => {
  const result = await createAgentGraph(
    roles({
      review: async () => ({ approved: false, feedback: "缺少验收" }),
    }),
    { maxAttempts: 2 },
  ).invoke({ goal: "方案" });
  assert.equal(result.status, "revision_limit");
  assert.equal(result.approved, false);
  assert.equal(result.attempts, 2);
  assert.equal(result.feedback, "缺少验收");
});

test("approval on the final allowed attempt is still successful", async () => {
  const result = await createAgentGraph(roles(), { maxAttempts: 1 }).invoke({
    goal: "方案",
  });
  assert.equal(result.status, "approved");
  assert.equal(result.attempts, 1);
});

test("empty input is rejected before any model call", async () => {
  let called = false;
  const graph = createAgentGraph(
    roles({
      plan: async () => {
        called = true;
        return { steps: ["方案"] };
      },
    }),
  );
  await assert.rejects(graph.invoke({ goal: "   " }));
  assert.equal(called, false);
});

test("attempt limits must be integers between one and five", () => {
  for (const maxAttempts of [0, -1, 1.5, 6, Number.NaN]) {
    assert.throws(() => createAgentGraph(roles(), { maxAttempts }));
  }
});

test("empty plans and drafts are rejected at the agent boundary", async () => {
  await assert.rejects(
    createAgentGraph(
      roles({
        plan: async () => ({ steps: [] }),
      }),
    ).invoke({ goal: "目标" }),
  );
  await assert.rejects(
    createAgentGraph(
      roles({
        execute: async () => ({ draft: "  " }),
      }),
    ).invoke({ goal: "目标" }),
  );
});

test("review rejection without actionable feedback is invalid", async () => {
  await assert.rejects(
    createAgentGraph(
      roles({
        review: async () => ({ approved: false, feedback: " " }),
      }),
    ).invoke({ goal: "目标" }),
  );
});

test("model failure is propagated without fabricating success", async () => {
  await assert.rejects(
    createAgentGraph(
      roles({
        execute: async () => {
          throw new Error("model unavailable");
        },
      }),
    ).invoke({ goal: "目标" }),
    /model unavailable/,
  );
});

test("separate invocations do not reuse a previous draft or attempt count", async () => {
  const graph = createAgentGraph(roles());
  await graph.invoke({ goal: "第一个目标" });
  const result = await graph.invoke({ goal: "第二个目标" });
  assert.equal(result.draft, "成果：第二个目标");
  assert.equal(result.attempts, 1);
});
