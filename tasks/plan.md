# 本地开发编排实施计划

项目配置 → 本地任务快照 → LangGraph / SQLite → Codex 执行器与命令验证 → diff / 报告。

保持一个核心流程，以接口替换 coding agent；清除旧文本原型。先 CLI，运行数据与目标仓库分离，修改仅在 worktree。检查命令由用户注册，不能由模型更改。

## 顺序

1. 配置、注册、持久化、锁：证明本地多仓库状态可靠。
2. worktree、命令执行和检查：证明隔离、失败结果与超时清理。
3. LangGraph / SQLite：替身执行器完成修改、失败、修复和重启恢复。
4. Codex CLI：结构化审核、会话与阶段结果保存，真实模型冒烟。
5. CLI、文档、清理、全量验证和本地提交。

任务状态仅在 todo.md 记录。

## 风险

- Windows SQLite：先安装与打开/关闭验证。
- agent 中断：checkpoint + 阶段结果 + session ID；未完成动作核对当前文件，不虚构 exactly-once。
- 降低测试：检查配置来自任务快照，审核读取实际 diff，保留日志。
- 环境缺依赖：显式 setup 与错误日志，不共享其他项目 node_modules。
- API/权限失败：进入可恢复错误状态，不放宽沙箱或假成功。
