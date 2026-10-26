import {
  ArrowUpRight,
  ChevronRight,
  CircleHelp,
  FolderGit2,
  GitBranch,
  Layers3,
  LayoutGrid,
  Plus,
  Search,
  Settings2,
  Terminal,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DashboardState, RunView } from "../src/dashboard/contracts.js";
import type { Project } from "../src/domain.js";
import { usePolling } from "./api.js";
import { Badge, RunPanel } from "./detail.js";
import { date, labels, phaseLabel, stateKey } from "./format.js";
import { Dialog, ProjectForm, TaskForm } from "./forms.js";
import "./style.css";

function App() {
  const [version, setVersion] = useState(0);
  const { data, error } = usePolling<DashboardState>("state", 1000, version);
  const [repo, setRepo] = useState("");
  const [selected, setSelected] = useState(
    new URLSearchParams(location.hash.slice(1)).get("run") ?? "",
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [modal, setModal] = useState<"project" | "task" | "help" | null>(null);
  const [editing, setEditing] = useState<Project>();
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const projects = data?.projects ?? [];
  const runs = data?.runs ?? [];
  const visible = runs.filter(
    (run) =>
      (!repo || run.project.id === repo) &&
      (!filter ||
        (filter === "running" ? run.active : stateKey(run) === filter)) &&
      `${run.task} ${run.id} ${run.project.id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selection = visible.some((r) => r.id === selected)
    ? selected
    : visible[0]?.id;
  const currentProject = projects.find((p) => p.id === repo);
  const refresh = () => setVersion((v) => v + 1);
  const select = (run: RunView) => {
    setSelected(run.id);
    history.replaceState(null, "", `#run=${run.id}`);
  };
  const edit = (project?: Project) => {
    setEditing(project);
    setModal("project");
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="本地开发台首页">
          <span className="brand-symbol">
            <Workflow size={24} />
          </span>
          <span>
            <strong>本地开发台</strong>
            <small>LANGGRAPH AGENTS</small>
          </span>
        </a>
        <div className="nav-section-title">
          工作空间<span className="local-pill">LOCAL</span>
        </div>
        <button
          type="button"
          className={`nav-item ${!repo ? "active" : ""}`}
          onClick={() => {
            setRepo("");
            setFilter("");
          }}
        >
          <LayoutGrid size={18} />
          <span>全部任务</span>
          <span className="nav-count">{runs.length}</span>
        </button>
        <div className="nav-section-title repo-title">
          代码仓库
          <button
            type="button"
            className="icon-button"
            aria-label="添加仓库"
            disabled={Boolean(data?.busy)}
            onClick={() => edit()}
          >
            <Plus size={17} />
          </button>
        </div>
        <nav className="repo-nav" aria-label="仓库列表">
          {projects.map((project) => (
            <div
              key={project.id}
              className={`repo-item ${repo === project.id ? "active" : ""}`}
            >
              <button
                type="button"
                className="repo-choice"
                onClick={() => {
                  setRepo(project.id);
                  setFilter("");
                }}
                title={project.repo}
              >
                <FolderGit2 size={18} />
                <span>{project.id}</span>
                <span className="nav-count">
                  {runs.filter((r) => r.project.id === project.id).length}
                </span>
              </button>
              <button
                type="button"
                className="repo-settings icon-button"
                aria-label={`${project.id} 仓库设置`}
                disabled={Boolean(data?.busy)}
                onClick={() => edit(project)}
              >
                <Settings2 size={14} />
              </button>
            </div>
          ))}
        </nav>
        {!projects.length && data && (
          <p className="sidebar-empty">
            添加一个本地仓库，开始你的第一个任务。
          </p>
        )}
        <button
          type="button"
          className="add-repo"
          disabled={Boolean(data?.busy)}
          onClick={() => edit()}
        >
          <Plus size={16} />
          添加仓库
        </button>
        <div className="sidebar-bottom">
          <div className="engine">
            <span className={`connection-dot ${error ? "offline" : ""}`} />
            <div>
              <strong>
                {error
                  ? "服务连接中断"
                  : data?.busy
                    ? "执行器运行中"
                    : "执行器就绪"}
              </strong>
              <small>本机串行 · Codex CLI</small>
            </div>
          </div>
          <button
            type="button"
            className="help-button"
            onClick={() => setModal("help")}
          >
            <CircleHelp size={16} />
            使用与数据位置
            <ArrowUpRight size={14} />
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工作空间</span>
            <ChevronRight size={14} />
            <strong>{repo || "全部仓库"}</strong>
          </div>
          <span className="connection-text">
            <span className={`connection-dot ${error ? "offline" : ""}`} />
            {error ? "连接中断" : "本地连接"}
            <span className="mono">127.0.0.1</span>
          </span>
        </header>
        <div className="page-heading">
          <div>
            <div className="eyebrow">DEVELOPMENT WORKBENCH</div>
            <h1>{currentProject ? currentProject.id : "开发任务"}</h1>
            <p>
              {currentProject
                ? currentProject.repo
                : "从一次代码修改，到可审阅的交付。"}
            </p>
          </div>
          <button
            type="button"
            className="button primary"
            disabled={!projects.length || !data}
            onClick={() => setModal("task")}
          >
            <Plus size={17} />
            创建任务
          </button>
        </div>
        {error && (
          <p className="global-error" role="alert">
            无法更新状态：{error}。请确认本地服务仍在运行，页面会自动重连。
          </p>
        )}
        {notice && (
          <div className="toast" role="status">
            {notice}
            <button
              type="button"
              onClick={() => setNotice("")}
              aria-label="关闭提示"
            >
              ×
            </button>
          </div>
        )}
        <div className="workbench">
          <section className="task-list" aria-label="开发任务列表">
            <div className="list-title">
              <h2>
                任务列表 <span>{visible.length}</span>
              </h2>
              <span className="live-caption">
                <span className="connection-dot" />
                实时更新
              </span>
            </div>
            <div className="list-filters">
              <div className="search-input">
                <Search size={16} />
                <input
                  aria-label="搜索任务"
                  placeholder="搜索任务或编号"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                aria-label="筛选任务状态"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">全部状态</option>
                {Object.entries(labels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="run-list">
              {visible.map((run) => (
                <button
                  type="button"
                  key={run.id}
                  className={`run-item ${selection === run.id ? "selected" : ""}`}
                  onClick={() => select(run)}
                  aria-pressed={selection === run.id}
                >
                  <div className="run-item-top">
                    <Badge run={run} />
                    <span className="mono">{run.id.slice(0, 7)}</span>
                  </div>
                  <h3>{run.task}</h3>
                  <div className="run-item-meta">
                    <span>
                      <GitBranch size={13} />
                      {run.project.id}
                    </span>
                    <span>{phaseLabel(run.phase)}</span>
                  </div>
                  <time>{date(run.createdAt)}</time>
                </button>
              ))}
            </div>
            {!visible.length && (
              <div className="list-empty">
                <Layers3 size={28} />
                <strong>
                  {!data
                    ? "正在连接本地服务…"
                    : search || filter
                      ? "没有匹配的任务"
                      : "这里还没有任务"}
                </strong>
                <p>
                  {search || filter
                    ? "尝试调整搜索词或状态筛选。"
                    : "任务的进度、日志和交付结果会保存在这里。"}
                </p>
              </div>
            )}
            <div className="list-footer">
              最近 200 项任务 · {runs.filter((r) => r.active).length} 项执行中
            </div>
          </section>
          {selection ? (
            <RunPanel
              key={selection}
              id={selection}
              busy={Boolean(data?.busy)}
              onChanged={refresh}
            />
          ) : (
            <section className="welcome">
              <div className="welcome-mark">
                <Workflow size={38} />
              </div>
              <span className="eyebrow">YOUR LOCAL WORKSPACE</span>
              <h2>
                {projects.length
                  ? "把下一项开发工作放进来"
                  : "连接仓库，开始编排"}
              </h2>
              <p>
                {projects.length
                  ? "描述任务和验收条件，编码、检查与审核将在独立工作区中进行。"
                  : "为仓库配置检查命令。每项任务都有独立工作区、完整日志和可恢复的进度。"}
              </p>
              <button
                type="button"
                className="button primary"
                onClick={() => (projects.length ? setModal("task") : edit())}
              >
                <Plus size={16} />
                {projects.length ? "创建第一个任务" : "添加第一个仓库"}
              </button>
              <div className="welcome-flow">
                <span>修改代码</span>
                <ChevronRight size={14} />
                <span>验证与修复</span>
                <ChevronRight size={14} />
                <span>审核交付</span>
              </div>
            </section>
          )}
        </div>
        <footer className="page-footer">
          <span>
            <Terminal size={13} />
            任务在本机执行，关闭页面后继续运行。
          </span>
          <span>LangGraph / Codex</span>
        </footer>
      </main>
      {modal === "project" && (
        <ProjectForm
          project={editing}
          onClose={() => setModal(null)}
          onSaved={(id) => {
            setModal(null);
            setRepo(id ?? "");
            refresh();
            setNotice(
              id ? `仓库 ${id} 已保存` : "仓库注册已移除，文件与任务保留",
            );
          }}
        />
      )}
      {modal === "task" && (
        <TaskForm
          projects={projects}
          initialProject={repo}
          busy={Boolean(data?.busy)}
          onClose={() => setModal(null)}
          onCreated={(run) => {
            setModal(null);
            setRepo(run.project.id);
            setFilter("");
            setSearch("");
            select(run);
            refresh();
            setNotice(
              run.active
                ? "任务已创建，正在启动执行器"
                : "任务已保存，可在详情中开始执行",
            );
          }}
        />
      )}
      {modal === "help" && (
        <Dialog
          title="本地工作空间"
          description="界面和 CLI 使用同一份任务数据。"
          onClose={() => setModal(null)}
        >
          <div className="form-body help-content">
            <h3>数据位置</h3>
            <code>{data?.dataDir ?? "连接后显示"}</code>
            <h3>执行与恢复</h3>
            <p>
              一个数据目录同时执行一项任务。新任务可以先保存，再手动启动。暂停后会保留修改和检查点；完成或失败的任务请通过新任务继续工作。
            </p>
            <p>
              关闭浏览器页面不会停止执行。终端中正常关闭本地服务时，会暂停该服务启动的任务。遇到进程异常退出，可检查日志后恢复。
            </p>
            <h3>交付</h3>
            <p>
              检查和审核通过后，在“交付文件”中下载 patch
              与报告；代码修改保留在任务工作区，供你审阅后提交。
            </p>
          </div>
          <div className="dialog-footer">
            <button
              className="button primary"
              type="button"
              onClick={() => setModal(null)}
            >
              知道了
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(<App />);
