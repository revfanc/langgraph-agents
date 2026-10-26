import { spawn as nativeSpawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import spawn from "cross-spawn";

export async function stopProcess(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = nativeSpawn(
        "taskkill",
        ["/PID", String(pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" },
      );
      killer.on("error", () => resolve());
      killer.on("close", () => resolve());
    });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* Already exited. */
    }
  }
}

export interface ProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  log: string;
  timeoutMs: number;
  signal?: AbortSignal;
  input?: string;
  maxOutputBytes?: number;
  onStart?: (pid: number) => void;
  onExit?: () => void;
  onLine?: (line: string) => void;
}

export async function runProcess(options: ProcessOptions) {
  options.signal?.throwIfAborted();
  mkdirSync(dirname(options.log), { recursive: true });
  writeFileSync(options.log, "", "utf8");
  return new Promise<{
    exitCode: number | null;
    passed: boolean;
    reason: string;
    tail: string;
    log: string;
  }>((resolve, reject) => {
    let reason = "exit";
    let tail = "";
    let bytes = 0;
    let pending = "";
    const decoder = new StringDecoder("utf8");
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stop = (why: string) => {
      if (reason !== "exit") return;
      reason = why;
      if (child.pid) void stopProcess(child.pid);
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const record = (buffer: Buffer) => {
      bytes += buffer.length;
      if (bytes > (options.maxOutputBytes ?? 10 * 1024 * 1024)) {
        stop("output_limit");
        return false;
      }
      try {
        appendFileSync(options.log, buffer);
      } catch (error) {
        tail = String(error);
        stop("log_error");
        return false;
      }
      tail = (tail + buffer.toString("utf8")).slice(-32_000);
      return true;
    };
    const line = (value: string) => {
      try {
        options.onLine?.(value);
      } catch (error) {
        tail = `${tail}\n${String(error)}`.slice(-32_000);
        stop("invalid_output");
      }
    };
    child.stdout?.on("data", (buffer: Buffer) => {
      if (!record(buffer)) return;
      pending += decoder.write(buffer);
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const value of lines) line(value);
      if (pending.length > 2_000_000) stop("output_limit");
    });
    child.stderr?.on("data", record);
    child.on("error", (error) => {
      reason = "spawn_error";
      tail = error.message;
      record(Buffer.from(error.message));
    });
    child.stdin?.on("error", () => {
      /* Child may exit before consuming input. */
    });
    child.stdin?.end(options.input ?? "");
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      pending += decoder.end();
      if (pending && reason === "exit") line(pending);
      try {
        options.onExit?.();
      } catch (error) {
        reject(error);
        return;
      }
      resolve({
        exitCode,
        passed: exitCode === 0 && reason === "exit",
        reason,
        tail,
        log: options.log,
      });
    });
    try {
      if (child.pid) options.onStart?.(child.pid);
    } catch (error) {
      tail = String(error);
      stop("tracking_error");
    }
  });
}
