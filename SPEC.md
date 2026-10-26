# 本地开发编排工具

用户已确认：单人、本地、多仓库；接入真实 coding agent，完成代码修改、验证、失败修复与断点恢复，不绑定具体项目。

## 首版交付

- CLI 注册多个 Git 仓库，每个项目独立配置 setup/check 命令、规则入口和可选模型。
- 从干净仓库的提交创建独立 worktree；保持原工作区不变。
- 官方 Codex CLI 执行代码任务，复用本机 Codex 登录；执行器使用 workspace-write，审核使用 read-only；不提供关闭沙箱的参数。
- LangGraph 组织 prepare → baseline → code → verify → review → finish；验证或审核失败进入有限修复循环。
- 官方 SQLite checkpointer 持久化图状态；记录阶段结果、agent 会话 ID、调用计数、检查日志、最终 diff。
- resume 读取同一任务快照和 worktree；复用已完成节点/阶段结果，中断中的 agent 继续原会话并核对当前文件。
- 原子写入元数据，同一数据目录只允许一个运行进程；可暂停并恢复，超时终止子进程。
- 检查以 executable + args 配置，默认不使用 shell。仅运行用户注册的本地可信仓库；setup/check 是受信任本机代码，不是恶意仓库隔离环境。
- 检查必须全通过，独立审核读取实际 diff 和检查结果，才交付 succeeded；保留失败与待处理状态。
- 交付 worktree、patch、检查结果和报告，用户审阅后自行提交/合并；不自动推送、合并、发布。

## 配置与数据

默认数据目录为启动目录下 `.orchestrator/`，可用 `--data-dir` 更改。每次任务保存配置快照、源提交和独立 run ID。修改项目配置不会改变旧任务。

项目规则从仓库读取；项目已有任务文档保持为业务任务来源。编排工具只记录自身执行状态。

## 验收

1. 多仓库注册、配置校验、任务隔离和原工作区保护。
2. 真实 worktree、真实检查、验证失败后修复并重新验证。
3. SQLite 跨进程恢复；暂停/异常后不重做已完成节点；完成后 resume 不重复执行。
4. Codex CLI 真实冒烟：修改测试仓库文件、检查通过、独立审核与交付。
5. 自动化测试覆盖进程终止、输出/时间限制、锁冲突、过期锁、重放边界与失败保留。
6. typecheck / test / lint / build 通过；区分替身测试和真实模型证据。

## 可靠性边界

setup/check 须可安全重试。任意外部副作用不能承诺 exactly-once；中断于外部动作和持久化之间时先核对工作区。禁止自动提交/发布降低重复副作用风险。单机文件权限和 Codex 沙箱构成首版边界，不宣称团队多租户隔离。

## 首版不包含

Web UI、多人账号、分布式队列、自动发布、远程设备集群、任意不可信仓库。

## 参考

- https://learn.chatgpt.com/docs/codex-sdk
- https://learn.chatgpt.com/docs/non-interactive-mode
- https://docs.langchain.com/oss/javascript/langgraph/persistence
- https://docs.langchain.com/oss/javascript/langgraph/interrupts
