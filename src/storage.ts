import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { z } from "zod";
import { type Project, ProjectSchema, type Run, RunSchema } from "./domain.js";

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
    this.saver.db
      .prepare(
        "INSERT INTO runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(run.id, JSON.stringify(RunSchema.parse(run)));
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
