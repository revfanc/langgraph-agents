import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CodingAgent } from "./domain.js";
import { isAlive, type Store } from "./storage.js";
import { createWorkflow, type Phase } from "./workflow.js";
import { prepareWorkspace } from "./workspace.js";

export function requestPause(store: Store, id: string) {
  store.run(id);
  writeFileSync(join(store.dir(id), "pause"), "pause", "utf8");
}

export async function executeRun(
  store: Store,
  id: string,
  agent: CodingAgent,
  options: {
    signal?: AbortSignal;
    pauseAfter?: Phase;
    onPhase?: (phase: string) => void;
  } = {},
) {
  const release = store.lock();
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const run = store.run(id);
    if (run.status === "succeeded" || run.status === "failed") return run;
    if (run.childPid && isAlive(run.childPid)) {
      throw new Error(
        `旧任务子进程 PID ${run.childPid} 仍活跃。请检查并等待/终止它后再恢复，不能同时写入 worktree。`,
      );
    }
    const marker = join(store.dir(id), "pause");
    if (existsSync(marker)) unlinkSync(marker);
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;
    timer = setInterval(() => {
      if (existsSync(marker)) controller.abort(new Error("用户请求暂停"));
    }, 200);
    store.updateRun(id, {
      status: "running",
      error: "",
      childPid: undefined,
      ownerPid: process.pid,
    });
    const graph = createWorkflow(store, run, agent, signal, options);
    const config = {
      configurable: { thread_id: id },
      recursionLimit: 50,
      durability: "sync" as const,
    };
    const previous = await graph.getState(config);
    if (previous.values?.runId) prepareWorkspace(run);
    try {
      // Nodes own cancellation: await subprocess shutdown before releasing the lease/DB.
      // Passing signal to invoke would also race the still-running node against abort.
      await graph.invoke(previous.values?.runId ? null : { runId: id }, {
        ...config,
      });
      const current = await graph.getState(config);
      const status = current.next.length ? "paused" : current.values.status;
      return store.updateRun(id, { status, error: "" });
    } catch (error) {
      return store.updateRun(id, {
        status: signal.aborted ? "paused" : "blocked",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (error) {
    return store.updateRun(id, {
      status: "blocked",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (timer) clearInterval(timer);
    if (store.run(id).ownerPid === process.pid)
      store.updateRun(id, { ownerPid: undefined });
    release();
  }
}
