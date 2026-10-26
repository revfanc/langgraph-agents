import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { z } from "zod";
import { type CheckCommand, CheckResultSchema, type Run } from "./domain.js";
import { runProcess } from "./process.js";
import type { Store } from "./storage.js";
import { inside } from "./workspace.js";

export async function cached<T>(
  store: Store,
  run: Run,
  key: string,
  schema: z.ZodType<T>,
  action: () => Promise<T>,
  reuse: (value: T) => boolean = () => true,
): Promise<T> {
  const previous = store.receipt(run.id, key, schema);
  if (previous !== undefined && reuse(previous)) return previous;
  const value = schema.parse(await action());
  store.saveReceipt(run.id, key, value);
  return value;
}

export async function runChecks(
  store: Store,
  run: Run,
  phase: string,
  commands: CheckCommand[],
  signal: AbortSignal,
) {
  const results = [];
  for (const [index, command] of commands.entries()) {
    signal.throwIfAborted();
    const result = await cached(
      store,
      run,
      `${phase}:${index}`,
      CheckResultSchema,
      async () => {
        const execution = await runProcess({
          ...command,
          cwd: inside(run.worktree, command.cwd),
          log: join(
            store.dir(run.id),
            `${phase.replaceAll(":", "-")}-${command.name}-${randomUUID()}.log`,
          ),
          signal,
          onStart: (childPid) => {
            store.updateRun(run.id, { childPid });
          },
          onExit: () => {
            store.updateRun(run.id, { childPid: undefined });
          },
        });
        signal.throwIfAborted();
        if (execution.reason === "spawn_error")
          throw new Error(`${command.name} 无法启动：${execution.tail}`);
        return { name: command.name, ...execution };
      },
      (previous) => phase !== "setup" || previous.passed,
    );
    results.push(result);
  }
  return results;
}
