# 本地验收记录

日期：2026-10-25 至 2026-10-26（America/Los_Angeles）。范围：Windows 上的单人本地、多仓库 CLI 与本地可视化界面；没有接管或修改业务仓库。

## 自动化验证

- `npm run typecheck`：通过。
- `npm test`：26 项通过，无跳过。
- `npm run lint`：通过。
- `npm run build`：通过；构建先校验目标路径，再清除本项目 dist，避免残留旧原型。

自动化测试使用可控 coding agent 替身，真实执行 Git worktree、检查子进程、SQLite 和独立 Node 进程。覆盖两个实际仓库注册、源仓库保护、未跟踪文件 patch、检查失败修复、审核退回修复、轮数与调用上限、输出上限、超时终止、暂停等待子进程退出、setup 失败后恢复、只读阶段修改检测、进程锁、跨进程断点恢复及硬退出后接管。

硬退出测试在文件修改完成、agent 结果尚未持久化时退出进程；恢复重试未完成动作并读取已有修改，证明恢复边界，而非任意副作用 exactly-once。

新增 HTTP 测试覆盖同源令牌、跨站和 Host 重绑定拒绝、文件路径限制、64 KB 日志窗口、启动互斥、运行时保存待执行任务、暂停/恢复、启动后立即暂停、正常关闭服务时等待工作进程停止、新服务和新 SQLite 连接读取已保存的暂停状态、产物下载、项目快照隔离和移除注册保留数据。工作进程使用可控 agent，实际执行完整 LangGraph 流程；这些测试不声称调用了真实模型。

## 本地界面：真实浏览器和 Codex

- 在浏览器注册第二个测试仓库 `ui-smoke`，源路径为 `work/ui-repo`；原 `live` 仓库仍可单独选择。
- 从表单保存任务，再启动；run ID：`7ac4891a-ebda-4068-9331-9b8ad0a351fe`。
- 真实 Codex 编码期间点击暂停，状态变为 paused；点击恢复，完成编码、验证和独立审核，最终 succeeded。共 1 轮编码、3 次 agent 调用（包括中断的第一次调用）。
- 检查界面正确展示基线 exit 1，以及修复后 3 项测试通过、exit 0；执行记录保存暂停和恢复过程，交付页列出 worktree、patch 和报告。
- patch SHA-256：`636e90dd5d933465271799274591549be0325c0ed61a2854badf2d26a9217220`。源测试仓库 `git status --porcelain` 为空。
- 实际浏览器验证 1440 px 桌面与 390 px 窄屏布局；390 px 下文档宽度等于视口宽度，没有横向溢出。浏览器控制台未发现 warning/error。
- 所有真实运行证据保留在 `work/live-data`，与正式默认目录 `.orchestrator` 分离。

## 真实 Codex：编码后退出再恢复

- run ID：`e84f164c-d2a4-4100-8f1c-cce0ab4ac6fb`。
- 独立测试仓库基线：`7db79983d4f6c20c2a0f4775e164c58e9659646f`。
- 任务：把错误的数值减法修复为加法，保留原断言并补充零值测试。
- `--pause-after code`：Codex 真正修改两个文件后，编排进程退出。
- 新进程 `resume`：从 verify 开始，不再次编码；3 项测试通过，独立只读会话审核通过，最终 `succeeded`。
- 报告：1 轮编码、2 次 agent 调用；生成 changes.patch、report.json、report.md。
- patch SHA-256：`8f56a1c7855b261b82dd8c6bae7ce1bc3ed18860cc8b45e433978b08bb33b1d7`。

## 真实 Codex：失败反馈、会话继续和修复

- run ID：`3947981e-bc4e-4737-8f36-643be057e454`。
- 同样在 code 后暂停；随后只在这个测试 worktree 内将加法改回减法，主动注入故障。不是模型自然产生的错误。
- 新进程 resume：verify:1 的 3 项测试全部失败，流程进入 code:2，Codex 依据失败证据修复代码。
- code:1 和 code:2 事件里的会话 ID 均为 `01a176cf-3dc5-70f1-a516-6b54b646f9ed`，证实继续同一编码会话。
- verify:2：3 项测试全部通过；review:2：独立会话 `01a176d0-bf9a-7a03-9d13-2fddc6f06779` 审核通过。
- 最终 `succeeded`：2 轮编码、3 次 agent 调用；patch SHA-256 为 `194e587c9119be149ad809fabf85fdeb0b0135bafb29b8ec9c134d3d5f768d61`。
- 核对 Codex 实际会话上下文：两轮编码均为 workspace-write，审核为 read-only，approval_policy 均为 never；模型为 CLI 当时选择的 gpt-6.1-sol。
- 最后检查源测试仓库：`git status --porcelain` 为空，原文件仍保持基线代码，未提交或推送 agent 修改。

本机完整原始证据保存在 `D:\github\langgraph-agents\work\live-data\runs\<run-id>`，测试 worktree 在同数据目录的 `worktrees` 下。这些日志与运行数据库被 Git 忽略，不随源码提交。

## 已修复的 Windows 接入问题

初次测试（run `680ff009-0818-4d93-9d14-55e8c6ff35e2`）请求 workspace-write，但实际会话是 read-only，读取命令被策略拒绝。适配器使用 `--ignore-user-config` 时遗漏了 Windows 原生沙箱后端配置。

显式传入本机已配置的 `windows.sandbox="elevated"` 后，真实读写与受限权限均得到验证。没有使用关闭沙箱、忽略执行策略或放开网络的参数。参考 [官方 Windows 沙箱配置](https://learn.chatgpt.com/docs/windows/windows-sandbox)。同时增加 `outcome=blocked` 契约：明确受阻不再记为完成，也不自动耗尽代码修复轮数。

## 适用范围

这些结果证明首版控制流程和真实 agent 接入可用，不能等同于大型项目交付能力或企业级运行保障。RN 原生构建、真机表现、大型仓库耗时、长期数据库升级、多人权限与远程部署尚未验收。项目检查的覆盖范围决定能自动验证什么；仍需审阅最终 diff。
