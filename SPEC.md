# LangGraph agent 编排

## 目标与范围

在 `D:\github\langgraph-agents` 创建独立 TypeScript / Node.js 项目。提供可运行、可替换角色实现的 LangGraph 编排基础：用户目标 → planner → executor → reviewer → 通过或修订。

- planner 生成 1–6 个计划步骤；executor 根据计划生成文本成果。
- reviewer 输出审核结论与具体反馈；不通过时携带上次成果和反馈再次执行。
- 默认最多执行 3 次（含首次），可设为 1–5 次。达到上限返回 `revision_limit`，不得标记成功。
- 模型调用使用 OpenAI 或兼容的 Chat Completions 接口，要求支持 tool calling。模型名称、密钥、可选 base URL 来自环境变量。
- 离线 demo 用确定性角色演示一次退回、修订、通过，明确标记为模拟输出。
- CLI 展示节点进度、最终文本和终止原因；业务模块可直接被其他 TypeScript 项目导入。
- 首版只生成文本成果，不包含任意代码执行、浏览器操作、HTTP 服务、数据库或跨进程恢复。

## 技术与目录

- Node.js >= 22.9，TypeScript strict，ES modules。
- `@langchain/langgraph` 1.5.2、`@langchain/core` 1.3.0、`@langchain/openai` 1.7.0、Zod 4.6.7，锁定依赖。
- `src/contracts.ts`：角色输入输出和校验。
- `src/graph.ts`：状态图和条件路由。
- `src/agents/`：真实模型与 demo 实现。
- `src/cli.ts`：命令行；`src/config.ts`：环境配置。
- `tests/`：Node 原生测试；`README.md`：安装、运行、扩展和流程图。

## 命令

```powershell
npm install
npm run demo -- "设计一个任务管理系统"
npm run dev -- "设计一个任务管理系统"
npm run typecheck
npm test
npm run lint
npm run build
npm start -- "设计一个任务管理系统"
```

## 代码约定

使用命名导出、明确的角色契约和依赖注入；函数与变量 camelCase、类型 PascalCase。业务路由由代码决定，模型只提供计划、成果、审核数据。

```typescript
const review = ReviewSchema.parse(await agents.review(context, config));
return { approved: review.approved, feedback: review.feedback };
```

## 验收与测试

- 在真实 LangGraph 上测试首次通过、退回后通过、持续退回到上限。
- 空目标、非法执行上限、空计划、空成果与非法审核数据必须失败。
- 模型异常向调用方传播，不能转成成功或静默切换 demo。
- 重复运行互不污染；离线 demo 无需密钥；CLI 输入错误和配置缺失给出可理解提示。
- typecheck、tests、lint、build 和编译产物的 demo 运行通过。
- 真实模型端到端验证需用户提供模型配置；离线通过不等同于真实模型验证。

## 边界

- 始终：校验边界数据、限制循环、保留失败结论、更新文档。
- 需额外授权：发布远程仓库、部署服务、加入能修改外部系统的工具。
- 禁止：提交密钥、修改其他项目、隐藏模型错误、把模拟结果描述为真实模型结果。

## 实施顺序

1. 角色契约与状态图：先用测试确认预期分支，再实现和构建。
2. 模型接入、CLI、离线示例：测试输入/配置，运行真实图的离线完整流程。
3. 文档与最终检查：记录运行方式和已验证边界。

## 参考

- https://docs.langchain.com/oss/javascript/langgraph/graph-api
- https://docs.langchain.com/oss/javascript/langgraph/workflows-agents
- https://docs.langchain.com/oss/javascript/integrations/chat/openai
