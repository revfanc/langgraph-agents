import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { ProjectSchema, type Run, RunSchema } from "./domain.js";
import type { Store } from "./storage.js";

export function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

export function inside(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error(`需要仓库相对路径：${path}`);
  const candidate = resolve(root, path);
  const rel = relative(root, candidate);
  if (
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(rel)
  ) {
    throw new Error(`路径超出工作区：${path}`);
  }
  if (existsSync(candidate)) {
    const real = realpathSync(candidate);
    const actual = relative(realpathSync(root), real);
    if (
      actual === ".." ||
      actual.startsWith("../") ||
      actual.startsWith("..\\") ||
      isAbsolute(actual)
    ) {
      throw new Error(`符号链接超出工作区：${path}`);
    }
  }
  return candidate;
}

export async function registerProject(
  store: Store,
  id: string,
  repo: string,
  config: unknown,
) {
  const root = realpathSync(repo);
  const gitRoot = realpathSync(
    git(root, ["rev-parse", "--show-toplevel"]).trim(),
  );
  if (root !== gitRoot) throw new Error("请注册仓库根目录");
  if (existsSync(join(root, ".gitmodules")))
    throw new Error("首版暂不支持包含 submodule 的仓库");
  const input = config as Record<string, unknown>;
  const project = ProjectSchema.parse({ ...input, id, repo: root });
  for (const command of [...project.setup, ...project.checks])
    inside(root, command.cwd);
  for (const rule of project.rules) inside(root, rule);
  const release = store.lock();
  try {
    store.saveProject(project);
  } finally {
    release();
  }
  return project;
}

export function createRun(
  store: Store,
  projectId: string,
  task: string,
  options: {
    maxAttempts?: number;
    maxAgentCalls?: number;
    agentTimeoutMs?: number;
  } = {},
): Run {
  const project = store.project(projectId);
  if (git(project.repo, ["status", "--porcelain"]).trim()) {
    throw new Error(
      "源仓库有未提交修改，请先处理后再启动；任务以已提交的 HEAD 为基线。",
    );
  }
  const id = randomUUID();
  const run = RunSchema.parse({
    version: 1,
    id,
    project,
    task,
    baseCommit: git(project.repo, ["rev-parse", "HEAD"]).trim(),
    worktree: join(store.root, "worktrees", id),
    branch: `orchestrator/${id}`,
    createdAt: new Date().toISOString(),
    ...options,
  });
  store.saveRun(run);
  store.dir(id);
  return run;
}

export function prepareWorkspace(run: Run) {
  if (!existsSync(join(run.worktree, ".git"))) {
    if (existsSync(run.worktree))
      throw new Error("目标目录存在但不是有效 worktree，保留现场以供检查。");
    mkdirSync(resolve(run.worktree, ".."), { recursive: true });
    const branchExists = git(run.project.repo, [
      "branch",
      "--list",
      run.branch,
    ]).trim();
    git(run.project.repo, [
      "-c",
      `core.hooksPath=${join(resolve(run.worktree, ".."), "disabled-hooks")}`,
      "worktree",
      "add",
      ...(branchExists ? [] : ["-b", run.branch]),
      run.worktree,
      branchExists ? run.branch : run.baseCommit,
    ]);
  }
  if (git(run.worktree, ["rev-parse", "HEAD"]).trim() !== run.baseCommit) {
    throw new Error(
      "任务 worktree 的 HEAD 已变化；编排不自动提交或重置，请检查现场。",
    );
  }
  if (git(run.worktree, ["branch", "--show-current"]).trim() !== run.branch) {
    throw new Error("任务 worktree 分支与任务记录不一致");
  }
}

export function snapshot(run: Run) {
  prepareWorkspace(run);
  const untracked = git(run.worktree, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter(Boolean);
  for (const path of untracked)
    git(run.worktree, ["add", "--intent-to-add", "--", path]);
  const diff = git(run.worktree, [
    "-c",
    "core.quotePath=false",
    "diff",
    "--binary",
    "--no-ext-diff",
    run.baseCommit,
    "--",
  ]);
  return { diff, hash: createHash("sha256").update(diff).digest("hex") };
}

export function projectRules(run: Run): string {
  return run.project.rules
    .map((name) => {
      const path = inside(run.worktree, name);
      return existsSync(path)
        ? `\n--- ${name} ---\n${readFileSync(path, "utf8").slice(0, 40_000)}`
        : "";
    })
    .join("")
    .slice(0, 80_000);
}
