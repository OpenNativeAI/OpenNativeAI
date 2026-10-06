#!/usr/bin/env node
/**
 * Local Agent 子进程入口（已退场：仅作 fail-fast 哨兵保留）。
 *
 * 2026-10 方案变更（修订三，见 `docs/specs/localagent-protocol-adapter.md` §1/§7）：
 * Lite 不再以独立二进制 + 协议适配器落地，而是换芯方案——作为会话级配置
 * `agentEngine: "lite"` 跑在现有 CLI 子进程的 AgentRuntime 内（精简 identity +
 * LITE_TOOL_ALLOWLIST 工具面，历史/权限/v4 协议全部复用）。原 PR-B（stdio 协议
 * 适配）/ PR-C（model-io 落盘）/ PR-D（spawn 分派与打包）均不实施：桌面活链路是
 * v4 command/frame（v4-gateway 3.4k 行 + 持久化 SessionEvent 投影），独立二进制
 * 要喂饱 UI 等于重写半个 CLI。
 *
 * 本包保留为**参考实现**：orchestrator.ts/tools.ts/llm.ts 的轻量循环语义已映射进
 * core 换芯分支（身份声明 → context/sections/lite-identity.ts；9 工具 →
 * runtime/helpers/tool-allowlist.ts 的 LITE_TOOL_ALLOWLIST）。
 * root 源 `agent/liteagent/` 为存档；`pnpm localagent:check/apply` 保留但退出生产路径。
 *
 * 保持 fail-fast，避免 host 静默拉起一个已作废的入口。
 */
console.error(
  "[opennativeai-localagent] 独立二进制方案已退场（换芯方案，见 docs/specs/localagent-protocol-adapter.md）；Lite 引擎现跑在 CLI 子进程内（agentEngine 会话字段）。本入口不再接线。",
);
process.exit(78); // EX_CONFIG — 入口已作废，与"运行时报错"区分
