import {
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  GitBranch,
  LoaderCircle,
  Pause,
  Play,
  Terminal,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  FileSlice,
  RunDetail,
  RunView,
} from "../src/dashboard/contracts.js";
import { api, usePolling } from "./api.js";
import {
  bytes,
  date,
  fileLabel,
  phaseLabel,
  stages,
  stateKey,
  statusLabel,
} from "./format.js";

export function Badge({ run }: { run: RunView }) {
  return (
    <span className={`badge ${stateKey(run)}`}>
      <span className="status-dot" />
      {statusLabel(run)}
    </span>
  );
}
function LogViewer({ id, name }: { id: string; name: string }) {
  const [follow, setFollow] = useState(true);
  const [offset, setOffset] = useState<number>();
  const [version, setVersion] = useState(0);
  const { data, error } = usePolling<FileSlice>(
    `runs/${id}/files/${encodeURIComponent(name)}${offset === undefined ? "" : `?offset=${offset}`}`,
    follow ? 1000 : 0,
    version,
  );
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (follow && data && box.current)
      box.current.scrollTop = box.current.scrollHeight;
  }, [data, follow]);
  return (
    <div className="log-viewer">
      <div className="log-meta">
        <span className="mono" title={name}>
          {name}
        </span>
        <a
          className="icon-button"
          href={`/api/runs/${id}/files/${encodeURIComponent(name)}?download=1`}
          aria-label="下载完整日志"
        >
          <Download size={16} />
        </a>
      </div>
      {error && (
        <p className="error-box" role="alert">
          日志读取失败：{error}
        </p>
      )}
      <textarea
        readOnly
        spellCheck={false}
        className="log-content"
        ref={box}
        aria-label="日志内容"
        value={data?.text || (data ? "暂时没有输出。" : "正在读取日志…")}
      />
      <div className="log-controls">
        <span>
          {data
            ? `${bytes(data.start)} – ${bytes(data.end)} / ${bytes(data.size)}`
            : "读取中"}
        </span>
        <div>
          <button
            type="button"
            className="icon-button"
            aria-label="查看更早日志"
            disabled={!data?.start}
            onClick={() => {
              setFollow(false);
              setOffset(Math.max(0, (data?.start ?? 0) - 65536));
            }}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="查看下一段日志"
            disabled={!data || data.end >= data.size}
            onClick={() => {
              setFollow(false);
              setOffset(data?.end);
            }}
          >
            <ChevronRight size={17} />
          </button>
          <button
            type="button"
            className={`text-button ${follow ? "selected" : ""}`}
            aria-pressed={follow}
            onClick={() => {
              setFollow(!follow);
              setOffset(undefined);
              setVersion((v) => v + 1);
            }}
          >
            <ArrowDownToLine size={14} />
            {follow ? "跟随最新" : "继续跟随"}
          </button>
        </div>
      </div>
    </div>
  );
}
export function RunPanel({
  id,
  busy,
  onChanged,
}: {
  id: string;
  busy: boolean;
  onChanged: () => void;
}) {
  const [version, setVersion] = useState(0);
  const { data, error } = usePolling<RunDetail>(`runs/${id}`, 1000, version);
  const [tab, setTab] = useState("logs");
  const [file, setFile] = useState("");
  const [action, setAction] = useState("");
  const [actionError, setActionError] = useState("");
  if (!data)
    return (
      <section className="detail empty-detail">
        <LoaderCircle className="spin" />
        <p>{error || "正在读取任务…"}</p>
      </section>
    );
  const { run, checks, files, events, attempts } = data;
  const terminal = ["succeeded", "failed"].includes(run.status);
  const current = stages.findIndex(
    ([stage]) => stage === run.phase.split(":")[0],
  );
  const logs = files.filter((f) => f.name.endsWith(".log"));
  const logName = file || logs[0]?.name;
  async function control(kind: "pause" | "resume") {
    setAction(kind);
    setActionError("");
    try {
      await api(`runs/${id}/${kind}`, { method: "POST", body: "{}" });
      setVersion((v) => v + 1);
      onChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "操作失败");
    } finally {
      setAction("");
    }
  }
  return (
    <section className="detail" aria-label="任务详情">
      <div className="detail-heading">
        <div className="detail-kicker">
          <span className="mono">TASK / {run.id.slice(0, 8)}</span>
          <Badge run={run} />
        </div>
        <h2>{run.task}</h2>
        <div className="detail-sub">
          <span>
            <GitBranch size={14} />
            {run.project.id}
          </span>
          <span>
            <Clock3 size={14} />
            {date(run.createdAt)}
          </span>
        </div>
        <div className="run-actions">
          {run.active && !terminal ? (
            <button
              type="button"
              className="button"
              disabled={Boolean(action) || run.pauseRequested}
              onClick={() => void control("pause")}
            >
              <Pause size={16} />
              {run.pauseRequested || action === "pause"
                ? "正在暂停…"
                : "暂停任务"}
            </button>
          ) : (
            !terminal && (
              <button
                type="button"
                className="button primary"
                disabled={Boolean(action) || busy}
                onClick={() => void control("resume")}
              >
                <Play size={16} />
                {action === "resume"
                  ? "正在启动…"
                  : run.status === "ready"
                    ? "开始执行"
                    : "恢复任务"}
              </button>
            )
          )}
          {busy && !run.active && !terminal && (
            <span className="muted">请先暂停正在运行的任务</span>
          )}
          {terminal && (
            <span className="delivery-note">
              <CheckCircle2 size={16} />
              {run.status === "succeeded"
                ? "检查与审核已通过，变更可供审阅"
                : "执行已结束，失败现场已保留"}
            </span>
          )}
        </div>
      </div>
      {(error || actionError) && (
        <p className="error-box" role="alert">
          {actionError || `状态更新失败：${error}`}
        </p>
      )}
      {run.interrupted && (
        <p className="notice">
          执行进程已退出。确认旧子进程停止后，可从检查点恢复。
        </p>
      )}
      {run.status === "paused" && (
        <p className="notice">任务已暂停，工作区和进度已保留，可继续恢复。</p>
      )}
      {run.error && run.status !== "paused" && (
        <details className="run-error" open>
          <summary>需要处理的问题</summary>
          <pre>{run.error}</pre>
        </details>
      )}
      <ol className="pipeline" aria-label="执行阶段">
        {stages.map(([stage, label], index) => {
          const completed =
            run.status === "succeeded" ||
            (index < current &&
              events.some((event) => event.phase.split(":")[0] === stage));
          const selected = current === index && run.status !== "succeeded";
          return (
            <li
              key={stage}
              className={`stage ${completed ? "complete" : ""} ${selected ? "current" : ""}`}
              aria-current={selected ? "step" : undefined}
            >
              <span className="stage-node">
                {completed ? (
                  <Check size={14} />
                ) : selected && run.active ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  index + 1
                )}
              </span>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>
      <div className="run-facts">
        <div>
          <span>当前阶段</span>
          <strong aria-live="polite">{phaseLabel(run.phase)}</strong>
        </div>
        <div>
          <span>编码轮次</span>
          <strong className="mono">
            {attempts || "—"} <small>/ {run.maxAttempts}</small>
          </strong>
        </div>
        <div>
          <span>Agent 调用</span>
          <strong className="mono">
            {run.agentCalls} <small>/ {run.maxAgentCalls}</small>
          </strong>
        </div>
        <div>
          <span>基线提交</span>
          <strong className="mono">{run.baseCommit.slice(0, 7)}</strong>
        </div>
      </div>
      <div className="detail-tabs" role="tablist" aria-label="任务信息">
        {[
          ["logs", "执行日志", Terminal],
          ["checks", "检查结果", CheckCircle2],
          ["events", "执行记录", Clock3],
          ["files", "交付文件", FileText],
        ].map(([key, label, Icon]) => {
          const TabIcon = Icon as typeof Terminal;
          return (
            <button
              type="button"
              key={String(key)}
              role="tab"
              id={`tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`panel-${key}`}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(String(key))}
            >
              <TabIcon size={16} />
              {String(label)}
            </button>
          );
        })}
      </div>
      <div
        className="tab-panel"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === "logs" &&
          (logs.length ? (
            <>
              <div className="log-select">
                <label htmlFor="log-file">日志来源</label>
                <select
                  id="log-file"
                  value={file}
                  onChange={(e) => setFile(e.target.value)}
                >
                  <option value="">最新日志</option>
                  {logs.map((log) => (
                    <option key={log.name} value={log.name}>
                      {fileLabel(log.name)}
                    </option>
                  ))}
                </select>
                <span className="muted">每次读取最多 64 KB</span>
              </div>
              {logName && <LogViewer key={logName} id={id} name={logName} />}
            </>
          ) : (
            <div className="empty-panel">
              <Terminal size={25} />
              <p>任务启动后，执行日志会显示在这里。</p>
            </div>
          ))}
        {tab === "checks" && (
          <div className="checks-list">
            {checks.length ? (
              [...checks].reverse().map((check) => (
                <details key={check.key} className="check-row">
                  <summary>
                    {check.passed ? (
                      <CheckCircle2 size={18} className="pass" />
                    ) : (
                      <XCircle size={18} className="fail" />
                    )}
                    <span>
                      <strong>{check.name}</strong>
                      <small>
                        {check.key.startsWith("baseline")
                          ? "基线检查"
                          : check.key.startsWith("setup")
                            ? "环境准备"
                            : `验证 · 第 ${check.key.split(":")[1]} 轮`}
                      </small>
                    </span>
                    <span className={check.passed ? "pass" : "fail"}>
                      {check.passed ? "通过" : "未通过"}
                    </span>
                    <span className="mono muted">
                      exit {check.exitCode ?? "—"}
                    </span>
                  </summary>
                  <pre>{check.tail || check.reason}</pre>
                </details>
              ))
            ) : (
              <div className="empty-panel">
                <CheckCircle2 size={25} />
                <p>检查完成后将保留退出码和输出证据。</p>
              </div>
            )}
          </div>
        )}
        {tab === "events" && (
          <div className="events">
            {events.length ? (
              [...events].reverse().map((event) => (
                <div className="event" key={event.seq}>
                  <span className="event-dot" />
                  <div>
                    <strong>{phaseLabel(event.phase)}</strong>
                    <span className="event-state">
                      {event.status === "running"
                        ? "执行中"
                        : {
                            ready: "已创建",
                            paused: "已暂停",
                            blocked: "受阻",
                            succeeded: "已完成",
                            failed: "未通过",
                          }[event.status]}
                    </span>
                    {event.error && <p>{event.error}</p>}
                  </div>
                  <time>{date(event.time)}</time>
                </div>
              ))
            ) : (
              <div className="empty-panel">
                <Clock3 size={25} />
                <p>
                  该任务创建于界面版本之前，尚无阶段历史。当前状态仍可查看。
                </p>
              </div>
            )}
          </div>
        )}
        {tab === "files" && (
          <>
            <div className="workspace-path">
              <span>任务工作区</span>
              <code>{run.worktree}</code>
              <span>分支</span>
              <code>{run.branch}</code>
            </div>
            <div className="artifact-list">
              {files
                .filter((f) => !f.name.endsWith(".log"))
                .map((f) => (
                  <a
                    key={f.name}
                    href={`/api/runs/${id}/files/${encodeURIComponent(f.name)}?download=1`}
                  >
                    <FileText size={18} />
                    <span>
                      {f.name}
                      <small>
                        {bytes(f.size)} · {date(f.modifiedAt)}
                      </small>
                    </span>
                    <Download size={16} />
                  </a>
                ))}
            </div>
            <p className="field-note">
              最终 patch
              和报告在任务结束后生成，变更保留在独立工作区中供你审阅。
            </p>
          </>
        )}
      </div>
    </section>
  );
}
