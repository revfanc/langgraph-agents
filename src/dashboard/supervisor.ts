import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Run } from "../domain.js";
import { stopProcess } from "../process.js";
import { requestPause } from "../runner.js";
import { isAlive, type Store } from "../storage.js";
import type { RunView } from "./contracts.js";

export class BusyError extends Error {}
export type LaunchWorker = (id: string, log: number) => ChildProcess;

export class Supervisor {
  private active?: {
    id: string;
    child: ChildProcess;
    done: Promise<void>;
    pauseRequested: boolean;
  };
  private closing = false;
  constructor(
    readonly store: Store,
    private launch?: LaunchWorker,
  ) {}
  get busy() {
    return Boolean(this.active || this.store.activeOwner());
  }
  get activeRunId() {
    return (
      this.active?.id ??
      this.store
        .runs()
        .find(
          (r) =>
            r.ownerPid === this.store.activeOwner() &&
            r.status === "running" &&
            r.ownerPid,
        )?.id
    );
  }
  view(run: Run): RunView {
    const active =
      this.active?.id === run.id ||
      Boolean(run.ownerPid && isAlive(run.ownerPid));
    return {
      ...run,
      active,
      interrupted: run.status === "running" && !active,
      pauseRequested:
        active &&
        ((this.active?.id === run.id && this.active.pauseRequested) ||
          existsSync(join(this.store.dir(run.id), "pause"))),
    };
  }
  start(id: string) {
    if (this.closing || this.busy)
      throw new BusyError("已有任务正在执行，请先暂停它，再启动其他任务。");
    const run = this.store.run(id);
    if (["succeeded", "failed"].includes(run.status))
      throw new Error("任务已结束；请创建新任务。");
    if (run.childPid && isAlive(run.childPid))
      throw new BusyError("旧子进程仍在运行，请先检查该进程。");
    const pauseMarker = join(this.store.dir(id), "pause");
    if (existsSync(pauseMarker)) unlinkSync(pauseMarker);
    const log = openSync(join(this.store.dir(id), "runner.log"), "a");
    let child: ChildProcess;
    try {
      if (this.launch) child = this.launch(id, log);
      else {
        const compiled = fileURLToPath(new URL("../cli.js", import.meta.url));
        const cli = existsSync(compiled)
          ? [compiled]
          : [
              "--import",
              "tsx",
              fileURLToPath(new URL("../cli.ts", import.meta.url)),
            ];
        child = spawn(
          process.execPath,
          [...cli, "--data-dir", this.store.root, "resume", id],
          {
            cwd: fileURLToPath(new URL("../..", import.meta.url)),
            windowsHide: true,
            stdio: ["ignore", log, log],
          },
        );
      }
    } finally {
      closeSync(log);
    }
    let failure = "";
    child.on("error", (error) => {
      failure = error.message;
    });
    // A pause can arrive before the worker has cleared a previous pause marker.
    const pauseTimer = setInterval(() => {
      if (
        this.active?.child === child &&
        this.active.pauseRequested &&
        ["ready", "running"].includes(this.store.run(id).status)
      )
        requestPause(this.store, id);
    }, 100);
    const done = new Promise<void>((resolve) => {
      child.on("close", () => {
        clearInterval(pauseTimer);
        try {
          const current = this.store.run(id);
          // Never alter a run taken over by another living owner.
          if (
            failure ||
            current.status === "ready" ||
            (current.status === "running" &&
              (!current.ownerPid || !isAlive(current.ownerPid)))
          ) {
            this.store.updateRun(id, {
              status: "blocked",
              ownerPid: undefined,
              error: failure || "执行进程已退出，可检查日志后恢复任务。",
            });
          }
        } finally {
          if (this.active?.child === child) this.active = undefined;
          resolve();
        }
      });
    });
    this.active = { id, child, done, pauseRequested: false };
  }
  pause(id: string) {
    if (!this.view(this.store.run(id)).active)
      throw new Error("任务当前未运行。");
    requestPause(this.store, id);
    if (this.active?.id === id) this.active.pauseRequested = true;
  }
  async close() {
    this.closing = true;
    const active = this.active;
    if (!active) return;
    this.pause(active.id);
    const timer = setTimeout(() => {
      if (active.child.pid) void stopProcess(active.child.pid);
    }, 15_000);
    try {
      await active.done;
    } finally {
      clearTimeout(timer);
    }
  }
}
