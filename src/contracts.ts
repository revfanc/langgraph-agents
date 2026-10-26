import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

export const GoalSchema = z.string().trim().min(1, "目标不能为空").max(20_000);
export const MaxAttemptsSchema = z.number().int().min(1).max(5);

export const PlanSchema = z.object({
  steps: z
    .array(z.string().trim().min(1).max(2_000))
    .min(1)
    .max(6)
    .describe("完成用户目标所需的 1 到 6 个具体步骤"),
});

export const DraftSchema = z.object({
  draft: z
    .string()
    .trim()
    .min(1)
    .max(60_000)
    .describe("根据计划完成的文本成果；修订时输出完整成果"),
});

export const ReviewSchema = z.object({
  approved: z.boolean().describe("成果是否完整满足用户目标和计划"),
  feedback: z
    .string()
    .trim()
    .min(1)
    .max(8_000)
    .describe("通过的理由，或不通过时具体、可执行的修改意见"),
});

export interface ExecutionContext {
  goal: string;
  plan: string[];
  draft: string;
  feedback: string;
}

export type ReviewContext = Pick<ExecutionContext, "goal" | "plan" | "draft">;

/** Replace individual roles without changing graph routing. */
export interface Agents {
  plan(
    goal: string,
    config?: RunnableConfig,
  ): Promise<z.infer<typeof PlanSchema>>;
  execute(
    context: ExecutionContext,
    config?: RunnableConfig,
  ): Promise<z.infer<typeof DraftSchema>>;
  review(
    context: ReviewContext,
    config?: RunnableConfig,
  ): Promise<z.infer<typeof ReviewSchema>>;
}
