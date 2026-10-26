# LangGraph Agents

面向单人本地开发的 TypeScript 编排工具，提供本地可视化界面和 CLI。注册多个 Git 仓库后，由真实 Codex coding agent 在独立 worktree 中修改代码，运行检查，根据失败日志修复，再交给独立只读会话审核。LangGraph 和 SQLite 保存进度，可退出进程后恢复。

```mermaid
flowchart LR
  prepare[准备 worktree / 环境] --> baseline[记录基线检查]
  baseline --> code[Codex 修改代码]
  code --> verify[执行配置中的检查]
  verify -->|通过| review[独立 Codex 审核]
  verify -->|失败且未达上限| code
  review -->|要求修复且未达上限| code
  review -->|通过| finish[patch / 报告 / 保留 worktree]
  verify -->|达到上限| failed[失败报告 / 保留现场]
  review -->|达到上限| failed
```

## 准备

需要 Node.js >= 22.9、Git 和已登录的 Codex CLI。CLI 必须支持 `exec --json`、`--output-schema`、`--ignore-user-config` 和 `exec resume`。本机验证环境：Windows、Node 24.19.0、Codex CLI 0.163.0-alpha.11.2。

```powershell
cd D:\github\langgraph-agents
npm ci
npm run build
codex --version
codex login status
node dist/cli.js --help
```

首次使用 Codex 需自行完成 `codex login`。Windows 需要已完成 Codex 原生 `elevated` 沙箱初始化；这里的 `elevated` 指初始化方式，agent 命令仍以受限身份执行。工具显式启用该后端，不自动修改系统配置。参见 [Windows 沙箱文档](https://learn.chatgpt.com/docs/windows/windows-sandbox)。其他平台使用 Codex 的默认沙箱实现。

适配器使用官方 [非交互 JSONL 协议](https://learn.chatgpt.com/docs/non-interactive-mode)，直接管理子进程以支持暂停和超时清理。它保留 Codex 登录，忽略用户 `config.toml` 中的模型、MCP 和插件配置，显式传入工作区权限；用户和项目的执行策略仍生效。自定义 provider 暂不支持。可用 `CODEX_BIN` 指定 Codex 可执行文件路径。

## 启动本地界面

完成上面的构建后运行：

```powershell
npm run ui
# 浏览器打开 http://127.0.0.1:4317

# 自定义数据位置或端口
node dist/cli.js serve --data-dir D:\agent-data --port 4318
```

1. 左侧添加仓库，填写唯一标识和 Git 仓库绝对路径；配置安装命令、检查命令、规则文件及可选模型。参数填写 JSON 数组，例如 `["run", "test"]`。
2. 点击「创建任务」，选择仓库，写明目标与验收要求，设置编码轮数、调用预算和超时。可以立即执行，也可以取消勾选后保存为待执行。
3. 任务详情显示执行阶段、调用次数、检查退出码、执行时间线和实时日志；「交付文件」可下载 patch 和报告，查看独立工作区位置。
4. 运行时点击「暂停任务」，等状态变为「已暂停」后可切换其他任务。点击「恢复任务」继续未完成动作；成功或失败终态需创建新任务。

页面约每秒刷新，任务列表显示最近 200 项；日志每次读取最多 64 KB，可以向前翻阅、停止跟随或下载完整文件。阶段轨道反映实际阶段，不估算完成百分比。界面与 CLI 使用同一个 `--data-dir` 时共享项目、任务和恢复记录；旧任务没有新增的时间线历史时会明确提示。

同一数据目录仍只执行一个任务，已保存的任务不会自动排队启动。关闭浏览器不会停止执行；在运行服务的终端按 Ctrl+C 会先暂停它启动的任务再退出。重启服务后可查看记录并手动恢复。若进程被强制终止，先检查界面状态和旧进程，避免重复启动。由独立 CLI 启动的任务可以在页面查看和请求暂停，但关闭界面服务不会代替你终止该 CLI。

编辑仓库配置只影响以后创建的任务。移除仓库注册保留源文件、任务和工作区，可用相同标识重新注册。已有任务继续使用原配置快照。

服务仅监听 `127.0.0.1`，校验 Host、Origin 和写请求会话令牌；没有远程账号体系，请使用打印的精确地址访问。它是本机开发界面，保持本地访问，不经代理公开到网络。

## 用 CLI 注册仓库

为项目准备 JSON 配置，按实际项目修改命令；模型不能改变任务保存的命令配置。

```json
{
  "setup": [
    { "name": "install", "command": "npm", "args": ["ci"], "timeoutMs": 600000 }
  ],
  "checks": [
    { "name": "typecheck", "command": "npm", "args": ["run", "typecheck"] },
    { "name": "test", "command": "npm", "args": ["test"], "timeoutMs": 300000 }
  ],
  "rules": ["AGENTS.md"]
}
```

```powershell
node dist/cli.js projects add frontend --repo D:\repos\frontend --config .\frontend.json
node dist/cli.js projects add backend --repo D:\repos\backend --config .\backend.json
node dist/cli.js projects list
```

无安装步骤可省略 `setup`。`checks` 至少一项且名称唯一，执行文件与参数分开写，不使用 `&&` 拼接。命令 `cwd` 默认为 `.`，必须是仓库内相对路径。`rules` 可列多个规则文件，缺失文件跳过。可设置 `model` 为账号可用模型；省略时使用 Codex 内置默认模型。

重复注册同一 id 更新配置，已有任务继续使用其配置快照。RN、Web、后端和工具库都使用相同接口，只需各自配置命令。原生构建依赖和真机验收需在相应平台准备；CLI 检查通过不代表真机行为已经验证。

## 执行与恢复

源仓库必须有提交且工作区干净。任务固定当前 HEAD，不复制未提交修改、被忽略文件、密钥或 `node_modules`。首版不支持 submodule。

```powershell
node dist/cli.js run frontend --task "修复搜索请求乱序覆盖结果的问题，补充回归测试"
node dist/cli.js runs
node dist/cli.js status <run-id>
node dist/cli.js resume <run-id>
```

默认数据目录为启动目录的 `.orchestrator`。建议从工具根目录运行，或给所有命令传相同的 `--data-dir D:\agent-data`。同一数据目录串行运行一个任务；注册多个仓库不等于并行调度。一个任务只处理一个仓库，不处理跨仓库事务。

| 参数                 | 默认值 | 含义                                                  |
| -------------------- | ------ | ----------------------------------------------------- |
| `--max-attempts`     | 3      | 首次编码与修复的总轮数，1–10                          |
| `--max-agent-calls`  | 10     | 编码和审核的总调用预算，1–30；失败调用也计入          |
| `--agent-timeout-ms` | 600000 | 每次 agent 调用超时                                   |
| `--pause-after`      | 无     | 在 prepare / baseline / code / verify / review 后暂停 |

预算在创建时固定，`resume` 不接受覆盖。调用次数与超时不是精确费用上限；Codex 返回的 token usage 另存于 SQLite。

运行中按 Ctrl+C，或在另一个终端执行 `node dist/cli.js pause <run-id>`。编排器终止当前子进程树，等待退出后保存暂停状态并释放锁，然后可 `resume`。

```powershell
node dist/cli.js run frontend --task "你的开发任务" --pause-after code
# 程序退出后启动新进程，继续验证和审核
node dist/cli.js resume <run-id>
```

| 状态                | 含义                                                     |
| ------------------- | -------------------------------------------------------- |
| `ready` / `running` | 已创建 / 执行中                                          |
| `paused`            | 暂停，可恢复                                             |
| `blocked`           | 权限、环境、进程、输出格式或预算等问题；处理原因后可恢复 |
| `succeeded`         | 配置检查与独立审核通过，交付时 diff 与验证一致           |
| `failed`            | 修复轮数耗尽，保留失败报告                               |

终态 `succeeded` / `failed` 的 `resume` 只返回状态，不重复执行。退出码：0 成功或查询、1 错误或 blocked、2 failed、3 paused。直接运行 `node dist/cli.js` 可取得原始退出码。

## 交付与数据

```text
.orchestrator/
  state.sqlite             项目、任务、阶段结果、会话、LangGraph 检查点
  worktrees/<run-id>/       独立分支及工作区修改
  runs/<run-id>/
    *.log                  基线、检查及 Codex 事件日志
    *.reply.json           agent 结构化结果
    changes.patch          完成或轮数耗尽时的差异，含新增文件
    report.json / report.md
```

任务打印 worktree 和产物绝对路径。用 `git -C <worktree> diff HEAD` 审阅，确认后自行提交、合并或应用 patch。快照把新文件标记为 intent-to-add 以纳入 diff，不创建提交。工作区的源提交和分支须保持原状；发现被提交、重置或切换分支会阻止继续交付。

工作完成后可自行用 Git `worktree remove` 清理不再需要的工作区；工具不会自动删除失败现场。备份时先暂停任务、停止执行进程，再复制整个数据目录。SQLite、日志及 patch 含任务、源码和模型输出，按本地项目数据管理。

## 恢复与权限边界

- 已完成节点、检查和 agent 结果有持久化记录，恢复不重复完成动作。成功 setup 复用，失败 setup 可重试并保留各次日志。
- 若文件修改后、结果保存前进程崩溃，会重试未完成动作。编码继续原会话并要求核对现有文件。setup/check 必须可安全重试；不承诺外部副作用恰好执行一次。
- 验证与 diff hash 绑定，审核和交付拒绝变更后的源码。完成的检查会复用，因此恢复时依赖、环境和外部服务须保持一致；环境变化应创建新任务重新验证。
- 同一数据目录有进程锁，旧进程死亡后可接管。记录的子进程仍活跃时先阻止恢复，避免同时写文件。PID 复用可能导致保守阻止。
- 编码使用 `workspace-write`，审核使用 `read-only`，禁止申请提权，工具网络关闭。只读不等于保密隔离，沙箱仍可能读取工作区外允许的文件。
- setup/check 是你配置的可信本机命令，在主机权限下执行，可以访问网络和本机环境。worktree 提供工作区分离，不是虚拟机；不要处理恶意仓库。agent 削弱检查脚本的风险由 diff 审核辅助识别，不能保证发现所有规避行为。

这是单机开发工具首版，不包含团队权限、队列服务、远程沙箱、密钥托管、完整审计平台或自动发布。

## 开发验证

```powershell
npm run typecheck
npm test
npm run lint
npm run build
```

自动化测试使用临时 Git 仓库、真实命令、SQLite 和独立进程；agent 使用可控替身，不消耗模型额度。真实 Codex 和浏览器交互证据另见 `VALIDATION.md`。接口在 `src/domain.ts`，流程在 `src/workflow.ts`，Codex 适配器在 `src/codex.ts`，HTTP 与工作进程管理在 `src/dashboard/`，React 界面在 `web/`，不含具体业务项目逻辑。修改界面后重新 `npm run build` 并刷新页面，修改服务端后需重启服务。

持久化采用 [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) 和官方 SQLite checkpointer。状态格式仍处于 0.x 阶段，升级前保留备份，不支持旧文本原型的数据迁移。
