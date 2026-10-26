import type { RunView } from "../src/dashboard/contracts.js";

export const labels: Record<string, string> = {
  ready: "待执行",
  running: "运行中",
  paused: "已暂停",
  blocked: "需处理",
  succeeded: "已完成",
  failed: "未通过",
  interrupted: "可恢复",
};
export const stages = [
  ["prepare", "准备环境"],
  ["baseline", "基线检查"],
  ["code", "代码修改"],
  ["verify", "验证检查"],
  ["review", "独立审核"],
  ["finish", "交付结果"],
] as const;
export const phaseLabel = (phase: string) =>
  stages.find(([key]) => key === phase.split(":")[0])?.[1] ?? "等待执行";
export const stateKey = (run: RunView) =>
  ["succeeded", "failed"].includes(run.status)
    ? run.status
    : run.pauseRequested
      ? "pausing"
      : run.interrupted
        ? "interrupted"
        : run.active && ["ready", "paused", "blocked"].includes(run.status)
          ? "starting"
          : run.status;
export const statusLabel = (run: RunView) =>
  stateKey(run) === "pausing"
    ? "正在暂停"
    : stateKey(run) === "starting"
      ? "启动中"
      : labels[stateKey(run)];
export const date = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
export const bytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 ** 2
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1024 ** 2).toFixed(1)} MB`;
export function fileLabel(name: string) {
  if (name === "runner.log") return "编排进程";
  if (name.startsWith("code-"))
    return `编码会话 · 调用 ${name.split("-")[1]?.split(".")[0]}`;
  if (name.startsWith("review-"))
    return `审核会话 · 调用 ${name.split("-")[1]?.split(".")[0]}`;
  if (name.startsWith("verify-"))
    return `验证 ${name.split("-")[1]} · ${name.replace(/^verify-\d+-[a-f0-9]{64}-/, "").replace(/-[a-f0-9-]{36}\.log$/, "")}`;
  if (name.startsWith("baseline-"))
    return `基线 · ${name.slice(9).replace(/-[a-f0-9-]{36}\.log$/, "")}`;
  if (name.startsWith("setup-"))
    return `环境准备 · ${name.slice(6).replace(/-[a-f0-9-]{36}\.log$/, "")}`;
  return name;
}
