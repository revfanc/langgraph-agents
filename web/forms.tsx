import { Plus, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { RunView } from "../src/dashboard/contracts.js";
import type { CheckCommand, Project } from "../src/domain.js";
import { api } from "./api.js";

export function Dialog({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const label = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <div>
          <h2 id={label}>{title}</h2>
          <p>{description}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
interface CommandDraft {
  key: string;
  name: string;
  command: string;
  args: string;
  cwd: string;
  timeoutMs: number;
}
const commandDraft = (c?: CheckCommand): CommandDraft => ({
  key: crypto.randomUUID(),
  name: c?.name ?? "test",
  command: c?.command ?? "npm",
  args: JSON.stringify(c?.args ?? ["test"]),
  cwd: c?.cwd ?? ".",
  timeoutMs: c?.timeoutMs ?? 120000,
});
function CommandFields({
  title,
  values,
  setValues,
}: {
  title: string;
  values: CommandDraft[];
  setValues: (values: CommandDraft[]) => void;
}) {
  return (
    <fieldset className="commands">
      <legend>{title}</legend>
      {values.map((command, index) => (
        <div className="command-row" key={command.key}>
          <div className="command-main">
            <label>
              名称
              <input
                required
                aria-label={`${title} ${index + 1} 名称`}
                value={command.name}
                onChange={(e) =>
                  setValues(
                    values.map((c) =>
                      c.key === command.key
                        ? { ...c, name: e.target.value }
                        : c,
                    ),
                  )
                }
              />
            </label>
            <label>
              执行程序
              <input
                required
                aria-label={`${title} ${index + 1} 执行程序`}
                value={command.command}
                onChange={(e) =>
                  setValues(
                    values.map((c) =>
                      c.key === command.key
                        ? { ...c, command: e.target.value }
                        : c,
                    ),
                  )
                }
              />
            </label>
            <label className="args">
              参数 · JSON 数组
              <input
                required
                aria-label={`${title} ${index + 1} 参数`}
                className="mono"
                value={command.args}
                onChange={(e) =>
                  setValues(
                    values.map((c) =>
                      c.key === command.key
                        ? { ...c, args: e.target.value }
                        : c,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="icon-button danger"
              aria-label={`移除${title} ${index + 1}`}
              onClick={() =>
                setValues(values.filter((c) => c.key !== command.key))
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
          <details className="command-extra">
            <summary>工作目录与超时</summary>
            <div className="form-grid">
              <label>
                仓库内目录
                <input
                  value={command.cwd}
                  onChange={(e) =>
                    setValues(
                      values.map((c) =>
                        c.key === command.key
                          ? { ...c, cwd: e.target.value }
                          : c,
                      ),
                    )
                  }
                />
              </label>
              <label>
                超时（秒）
                <input
                  type="number"
                  min="1"
                  max="3600"
                  value={command.timeoutMs / 1000}
                  onChange={(e) =>
                    setValues(
                      values.map((c) =>
                        c.key === command.key
                          ? { ...c, timeoutMs: Number(e.target.value) * 1000 }
                          : c,
                      ),
                    )
                  }
                />
              </label>
            </div>
          </details>
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        onClick={() => setValues([...values, commandDraft()])}
      >
        <Plus size={15} />
        添加{title}
      </button>
    </fieldset>
  );
}
export function ProjectForm({
  project,
  onClose,
  onSaved,
}: {
  project?: Project;
  onClose: () => void;
  onSaved: (id?: string) => void;
}) {
  const [id, setId] = useState(project?.id ?? "");
  const [repo, setRepo] = useState(project?.repo ?? "");
  const [checks, setChecks] = useState(
    (project?.checks ?? [undefined]).map(commandDraft),
  );
  const [setup, setSetup] = useState((project?.setup ?? []).map(commandDraft));
  const [rules, setRules] = useState(
    (project?.rules ?? ["AGENTS.md"]).join("\n"),
  );
  const [model, setModel] = useState(project?.model ?? "");
  const [pending, setPending] = useState(false);
  const [remove, setRemove] = useState(false);
  const [error, setError] = useState("");
  const parse = (rows: CommandDraft[]) =>
    rows.map(({ key: _key, args, ...rest }) => ({
      ...rest,
      args: JSON.parse(args) as unknown,
    }));
  async function save() {
    setPending(true);
    setError("");
    try {
      if (!checks.length) throw new Error("至少添加一条验证检查。");
      await api("projects", {
        method: "POST",
        body: JSON.stringify({
          id,
          repo,
          replace: Boolean(project),
          config: {
            checks: parse(checks),
            setup: parse(setup),
            rules: rules
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
            ...(model.trim() ? { model: model.trim() } : {}),
          },
        }),
      });
      onSaved(id);
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      title={project ? "仓库设置" : "添加仓库"}
      description="设置代码位置与验证命令，后续任务将使用这份配置。"
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={pending} className="form-body">
          <div className="form-grid">
            <label>
              仓库标识
              <input
                required
                pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}"
                placeholder="my-project"
                value={id}
                disabled={Boolean(project)}
                onChange={(e) => setId(e.target.value)}
              />
            </label>
            <label>
              模型（可选）
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="使用 Codex 默认模型"
              />
            </label>
          </div>
          <label>
            仓库绝对路径
            <input
              required
              className="mono"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="D:\repos\my-project"
            />
          </label>
          <CommandFields
            title="验证检查"
            values={checks}
            setValues={setChecks}
          />
          <CommandFields title="环境准备" values={setup} setValues={setSetup} />
          <label>
            规则文件 · 每行一个仓库内路径
            <textarea
              rows={2}
              className="mono"
              value={rules}
              onChange={(e) => setRules(e.target.value)}
            />
          </label>
          <p className="field-note">
            命令在本机执行。仅添加你信任的仓库和命令；编辑配置不会改变已有任务。
          </p>
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
          {remove && (
            <div className="remove-confirm">
              <p>移除仓库注册后，文件与历史任务仍会保留。</p>
              <button
                type="button"
                className="button danger"
                onClick={async () => {
                  setPending(true);
                  setError("");
                  try {
                    await api(`projects/${encodeURIComponent(id)}`, {
                      method: "DELETE",
                    });
                    onSaved();
                  } catch (error) {
                    setError(String(error));
                  } finally {
                    setPending(false);
                  }
                }}
              >
                确认移除
              </button>
              <button
                type="button"
                className="button subtle"
                onClick={() => setRemove(false)}
              >
                取消
              </button>
            </div>
          )}
        </fieldset>
        <div className="dialog-footer">
          {project && (
            <button
              type="button"
              className="text-button danger"
              disabled={pending}
              onClick={() => setRemove(true)}
            >
              <Trash2 size={15} />
              移除注册
            </button>
          )}
          <div className="footer-actions">
            <button
              type="button"
              className="button subtle"
              disabled={pending}
              onClick={onClose}
            >
              取消
            </button>
            <button className="button primary" type="submit" disabled={pending}>
              {pending ? "正在保存…" : "保存仓库"}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

export function TaskForm({
  projects,
  initialProject,
  busy,
  onClose,
  onCreated,
}: {
  projects: Project[];
  initialProject: string;
  busy: boolean;
  onClose: () => void;
  onCreated: (run: RunView) => void;
}) {
  const [projectId, setProjectId] = useState(
    initialProject || projects[0]?.id || "",
  );
  const [task, setTask] = useState("");
  const [start, setStart] = useState(!busy);
  const [attempts, setAttempts] = useState(3);
  const [calls, setCalls] = useState(10);
  const [timeout, setTimeoutValue] = useState(10);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      title="创建开发任务"
      description="明确要修改的行为、验收条件，以及需要保留的约束。"
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError("");
          try {
            onCreated(
              await api<RunView>("runs", {
                method: "POST",
                body: JSON.stringify({
                  projectId,
                  task,
                  start: start && !busy,
                  maxAttempts: attempts,
                  maxAgentCalls: calls,
                  agentTimeoutMs: timeout * 60000,
                }),
              }),
            );
          } catch (error) {
            setError(error instanceof Error ? error.message : "创建失败");
          } finally {
            setPending(false);
          }
        }}
      >
        <fieldset disabled={pending} className="form-body">
          <label>
            目标仓库
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              required
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            任务描述
            <textarea
              required
              minLength={1}
              maxLength={30000}
              rows={6}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="例如：修复搜索请求乱序覆盖结果的问题，补充回归测试，保留现有接口。"
            />
          </label>
          <details className="budget">
            <summary>
              执行预算
              <span>
                最多 {attempts} 轮 · {calls} 次调用
              </span>
            </summary>
            <div className="form-grid thirds">
              <label>
                编码总轮数
                <input
                  type="number"
                  min="1"
                  max="10"
                  required
                  value={attempts}
                  onChange={(e) => setAttempts(Number(e.target.value))}
                />
              </label>
              <label>
                Agent 调用上限
                <input
                  type="number"
                  min="1"
                  max="30"
                  required
                  value={calls}
                  onChange={(e) => setCalls(Number(e.target.value))}
                />
              </label>
              <label>
                每次超时（分钟）
                <input
                  type="number"
                  min="1"
                  max="60"
                  required
                  value={timeout}
                  onChange={(e) => setTimeoutValue(Number(e.target.value))}
                />
              </label>
            </div>
          </details>
          <label className="checkbox">
            <input
              type="checkbox"
              disabled={busy}
              checked={start && !busy}
              onChange={(e) => setStart(e.target.checked)}
            />
            创建后立即执行
          </label>
          <p className="field-note">
            {busy
              ? "已有任务运行中，新任务将保存为待执行，不会自动排队启动。"
              : "任务从干净仓库的当前提交创建独立工作区。"}
          </p>
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
        </fieldset>
        <div className="dialog-footer">
          <div className="footer-actions">
            <button
              className="button subtle"
              type="button"
              onClick={onClose}
              disabled={pending}
            >
              取消
            </button>
            <button className="button primary" type="submit" disabled={pending}>
              {pending
                ? "正在创建…"
                : start && !busy
                  ? "创建并执行"
                  : "保存任务"}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
