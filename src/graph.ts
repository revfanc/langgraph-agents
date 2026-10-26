import {
  END,
  type GraphNode,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import { z } from "zod";
import {
  type Agents,
  DraftSchema,
  GoalSchema,
  MaxAttemptsSchema,
  PlanSchema,
  ReviewSchema,
} from "./contracts.js";

const InputState = new StateSchema({ goal: GoalSchema });

export const WorkflowState = new StateSchema({
  goal: GoalSchema,
  plan: z.array(z.string()).default(() => []),
  draft: z.string().default(""),
  feedback: z.string().default(""),
  approved: z.boolean().default(false),
  attempts: z.number().int().default(0),
  status: z.enum(["running", "approved", "revision_limit"]).default("running"),
});

export type WorkflowResult = typeof WorkflowState.State;

export function createAgentGraph(
  agents: Agents,
  options: { maxAttempts?: number } = {},
) {
  const maxAttempts = MaxAttemptsSchema.parse(options.maxAttempts ?? 3);

  const planner: GraphNode<typeof WorkflowState> = async (state, config) => {
    const goal = GoalSchema.parse(state.goal);
    const plan = PlanSchema.parse(await agents.plan(goal, config));
    return {
      goal,
      plan: plan.steps,
      draft: "",
      feedback: "",
      approved: false,
      attempts: 0,
      status: "running",
    };
  };

  const executor: GraphNode<typeof WorkflowState> = async (state, config) => {
    const { goal, plan, draft, feedback } = state;
    const result = DraftSchema.parse(
      await agents.execute({ goal, plan, draft, feedback }, config),
    );
    return {
      draft: result.draft,
      attempts: state.attempts + 1,
      approved: false,
    };
  };

  const reviewer: GraphNode<typeof WorkflowState> = async (state, config) => {
    const { goal, plan, draft } = state;
    return ReviewSchema.parse(
      await agents.review({ goal, plan, draft }, config),
    );
  };

  // Typed state + conditional edges: https://docs.langchain.com/oss/javascript/langgraph/graph-api
  return new StateGraph({ state: WorkflowState, input: InputState })
    .addNode("planner", planner)
    .addNode("executor", executor)
    .addNode("reviewer", reviewer)
    .addNode("finish", (state) => ({
      status: state.approved
        ? ("approved" as const)
        : ("revision_limit" as const),
    }))
    .addEdge(START, "planner")
    .addEdge("planner", "executor")
    .addEdge("executor", "reviewer")
    .addConditionalEdges(
      "reviewer",
      (state) =>
        state.approved || state.attempts >= maxAttempts ? "finish" : "executor",
      ["finish", "executor"],
    )
    .addEdge("finish", END)
    .compile();
}
