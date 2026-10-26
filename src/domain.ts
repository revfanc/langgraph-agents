import { z } from "zod";

export const CommandSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z0-9._-]+$/),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().default("."),
    timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000),
  })
  .strict();

export const ProjectSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
    repo: z.string().min(1),
    setup: z.array(CommandSchema).default([]),
    checks: z.array(CommandSchema).min(1),
    rules: z.array(z.string()).default(["AGENTS.md"]),
    model: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (p) => new Set(p.checks.map((c) => c.name)).size === p.checks.length,
    "检查名称不能重复",
  );

export const RunSchema = z.object({
  version: z.literal(1),
  id: z.uuid(),
  project: ProjectSchema,
  task: z.string().trim().min(1).max(30_000),
  baseCommit: z.string(),
  worktree: z.string(),
  branch: z.string(),
  createdAt: z.string(),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  maxAgentCalls: z.number().int().min(1).max(30).default(10),
  agentTimeoutMs: z.number().int().min(1_000).max(3_600_000).default(600_000),
  agentCalls: z.number().int().default(0),
  status: z
    .enum(["ready", "running", "paused", "blocked", "succeeded", "failed"])
    .default("ready"),
  phase: z.string().default("created"),
  error: z.string().default(""),
  childPid: z.number().int().optional(),
});

export const CheckResultSchema = z.object({
  name: z.string(),
  exitCode: z.number().nullable(),
  passed: z.boolean(),
  log: z.string(),
  tail: z.string(),
  reason: z.string(),
});
export const CodeResultSchema = z.object({
  outcome: z.enum(["completed", "blocked"]),
  summary: z.string().min(1),
});
export const ReviewResultSchema = z.object({
  approved: z.boolean(),
  summary: z.string().min(1),
  issues: z.array(z.string()),
});

export type Project = z.infer<typeof ProjectSchema>;
export type Run = z.infer<typeof RunSchema>;
export type CheckCommand = z.infer<typeof CommandSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
export interface AgentRequest {
  run: Run;
  attempt: number;
  prompt: string;
  signal: AbortSignal;
}
export interface CodingAgent {
  code(request: AgentRequest): Promise<z.infer<typeof CodeResultSchema>>;
  review(request: AgentRequest): Promise<ReviewResult>;
}
