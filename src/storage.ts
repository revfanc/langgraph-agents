import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { z } from "zod";
import { type Project, ProjectSchema, type Run, RunSchema } from "./domain.js";

export interface RunEvent {
  seq: number;
  time: string;
  status: Run["status"];
  phase: string;
  error: string;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export class Store {
  readonly root: string;
  readonly saver: SqliteSaver;
  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
    this.saver = SqliteSaver.fromConnString(join(this.root, "state.sqlite"));
    this.saver.db.pragma("journal_mode = WAL");
    this.saver.db.pragma("busy_timeout = 5000");
    this.saver.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (run TEXT, key TEXT, value TEXT NOT NULL, PRIMARY KEY(run,key));
      CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, run TEXT NOT NULL, time TEXT NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL, error TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS run_events_run ON run_events(run,seq);
    `);
  }
  close() {
    this.saver.db.close();
  }
  project(id: string): Project {
    const row = this.saver.db
      .prepare("SELECT value FROM projects WHERE id=?")
      .get(id) as { value: string } | undefined;
    if (!row) throw new Error(`项目不存在：${id}`);
    return ProjectSchema.parse(JSON.parse(row.value));
  }
  projects(): Project[] {
    return (
      this.saver.db.prepare("SELECT value FROM projects ORDER BY id").all() as {
        value: string;
      }[]
    ).map((r) => ProjectSchema.parse(JSON.parse(r.value)));
  }
  saveProject(project: Project) {
    this.saver.db
      .prepare(
        "INSERT INTO projects VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(project.id, JSON.stringify(ProjectSchema.parse(project)));
  }
  removeProject(id: string) {
    this.project(id);
    const release = this.lock();
    try {
      this.saver.db.prepare("DELETE FROM projects WHERE id=?").run(id);
    } finally {
      release();
    }
  }
  run(id: string): Run {
    const row = this.saver.db
      .prepare("SELECT value FROM runs WHERE id=?")
      .get(id) as { value: string } | undefined;
    if (!row) throw new Error(`任务不存在：${id}`);
    return RunSchema.parse(JSON.parse(row.value));
  }
  runs(): Run[] {
    return (
      this.saver.db
        .prepare("SELECT value FROM runs ORDER BY rowid DESC")
        .all() as { value: string }[]
    ).map((r) => RunSchema.parse(JSON.parse(r.value)));
  }
  saveRun(run: Run) {
    const parsed = RunSchema.parse(run);
    this.saver.db.transaction(() => {
      const previous = this.saver.db
        .prepare("SELECT value FROM runs WHERE id=?")
        .get(run.id) as { value: string } | undefined;
      const old = previous
        ? RunSchema.parse(JSON.parse(previous.value))
        : undefined;
      this.saver.db
        .prepare(
          "INSERT INTO runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(run.id, JSON.stringify(parsed));
      if (
        !old ||
        old.status !== run.status ||
        old.phase !== run.phase ||
        old.error !== run.error
      ) {
        this.saver.db
          .prepare(
            "INSERT INTO run_events(run,time,status,phase,error) VALUES (?,?,?,?,?)",
          )
          .run(
            run.id,
            new Date().toISOString(),
            run.status,
            run.phase,
            run.error,
          );
      }
    })();
  }
  updateRun(id: string, patch: Partial<Run>): Run {
    const run = RunSchema.parse({ ...this.run(id), ...patch });
    this.saveRun(run);
    return run;
  }
  receipt<T>(run: string, key: string, schema: z.ZodType<T>): T | undefined {
    const row = this.saver.db
      .prepare("SELECT value FROM receipts WHERE run=? AND key=?")
      .get(run, key) as { value: string } | undefined;
    return row ? schema.parse(JSON.parse(row.value)) : undefined;
  }
  saveReceipt(run: string, key: string, value: unknown) {
    this.saver.db
      .prepare(
        "INSERT INTO receipts VALUES (?,?,?) ON CONFLICT(run,key) DO UPDATE SET value=excluded.value",
      )
      .run(run, key, JSON.stringify(value));
  }
  receipts(id: string): { key: string; value: unknown }[] {
    return (
      this.saver.db
        .prepare("SELECT key,value FROM receipts WHERE run=? ORDER BY rowid")
        .all(id) as { key: string; value: string }[]
    ).map((row) => ({ key: row.key, value: JSON.parse(row.value) as unknown }));
  }
  events(id: string): RunEvent[] {
    return this.saver.db
      .prepare(
        "SELECT seq,time,status,phase,error FROM run_events WHERE run=? ORDER BY seq DESC LIMIT 200",
      )
      .all(id)
      .reverse() as RunEvent[];
  }
  activeOwner(): number | undefined {
    const lease = this.saver.db
      .prepare("SELECT pid FROM lease WHERE id=1")
      .get() as { pid: number } | undefined;
    return lease && isAlive(lease.pid) ? lease.pid : undefined;
  }
  dir(id: string): string {
    z.uuid().parse(id);
    const path = join(this.root, "runs", id);
    mkdirSync(path, { recursive: true });
    return path;
  }
  artifact(id: string, name: string, contents: string): string {
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error("非法产物文件名");
    const path = join(this.dir(id), name);
    const temp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temp, contents, "utf8");
    renameSync(temp, path);
    return path;
  }
  lock(): () => void {
    const token = randomUUID();
    this.saver.db
      .transaction(() => {
        const lease = this.saver.db
          .prepare("SELECT pid FROM lease WHERE id=1")
          .get() as { pid: number } | undefined;
        if (lease && isAlive(lease.pid))
          throw new Error(`已有编排进程运行（PID ${lease.pid}）。请先暂停它。`);
        this.saver.db
          .prepare("INSERT OR REPLACE INTO lease VALUES (1,?,?)")
          .run(process.pid, token);
      })
      .immediate();
    return () => {
      this.saver.db.prepare("DELETE FROM lease WHERE token=?").run(token);
    };
  }
}
