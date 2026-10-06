# Lite Agent 集成 Phase 2 Spec — 按会话引擎换芯方案

状态：实施中（2026-10-03 修订三：由"独立二进制 + 协议适配器"改为本方案；修订历史见 §1）
范围：`packages/shared/src/opennativeai-protocol/`、`packages/shared/src/opennativeai-protocol-v4/`、`apps/opennativeai-cli/packages/{core,bootstrap}/**`、`packages/services/src/{opennativeai-agent,node}.ts`、设置页文案（`packages/ui/src/settings/AgentRuntimeSection.tsx`、locales）。
不改动：`packages/desktop/src/host/localEngine/**`、v4 协议词表结构（仅 additive 可选字段）、主 CLI 默认引擎行为。

## 1. 背景与方案变更缘由

- Phase 1 已完成：`agent/liteagent/`（用户源，存档保留）迁入 `apps/opennativeai-cli/packages/localagent/`，包可编译；`bin.ts` fail-fast（exit 78）。
- 原方案（修订二之前）：独立 `opennativeai-localagent.cjs` 二进制自实现 stdio 协议服务。调研证伪：桌面会话的活链路是 v4 command/frame（`v4-gateway.ts` 3.4k 行 + 已持久化 SessionEvent 的投影管线 + CommandInbox/CAS/resume 裁决），spec §4 旧映射表所依赖的 legacy 通知词在桌面链路已清零。独立二进制要喂饱 UI，等于重写半个 CLI，成本以月计。
- 本方案（换芯）：引擎作为**会话级配置**随 create/resume 参数进入现有 CLI 子进程；Lite = 精简 system prompt + 精简工具面白名单，循环、历史、权限、model-io、v4 协议全部复用 `AgentRuntime` 现有机器。协议/持久化/日志/历史回放白送。
- 与"CLI 子进程是会话状态唯一所有者"决策（记忆 `d2d9566e`）一致：该决策本意是防止嵌入 Host 造成双主人；换芯后引擎仍跑在 CLI 子进程内，所有者不变。

## 2. 目标

1. 全局设置 `settings.agentRuntime`（`"default" | "lite"`，默认 `"default"`）由 Host 在**创建会话时**读取，映射为协议字段 `agentEngine` 随 `session/create`、v4 `createSession` 命令与 `session/resume` 下发。不做 spawn 分派、不加二进制、进程 key 不变。
2. Lite 引擎语义（CLI 内）：
   - system prompt：Lite 身份声明替换默认 identity；跳过 desktop 段、session guidance、skills、memory、output style。
   - 工具面：内置工具注册表与 `LITE_TOOL_ALLOWLIST` 取交集，并与调用方显式 `toolAllowlist`（如 CUA 隔离）再取交集（fail-closed）。
   - env 段 `Agent:` 行按实际引擎动态输出（default/lite），满足身份自我声明（§5）。
3. 运行中会话不迁移：engine 在创建时固定进 runtime config；resume（冷恢复/重开）由 Host 按**当时**的 `settings.agentRuntime` 下发——v1 的诚实边界，写入 §7 不做的事。
4. 旧 CLI 兼容：`agentEngine` 与 `toolAllowlist` 同组进入 create/resume 的 optional compat 降级字段集，旧 app-server 不认时省略重试，缺省即 default（fail-closed）。
5. 智能体身份自我声明：模型必须能从系统提示词知道当前是哪个智能体。声明由实际运行的引擎发出，**不注入**设置原文：default 引擎 env 段输出 `Agent: default (OpenNativeAI full CLI agent)`；lite 引擎输出 `Agent: lite (OpenNativeAI Lite Agent)` 且 identity 段自带 Lite 声明。验收：同一问题"你是什么智能体"，两条引擎的会话分别如实回答。

## 3. 状态所有者与数据流

```
Renderer（设置页 agentRuntime）
  │ ISettingService.update（既有通道）
  ▼
Host AppSettings（唯一事实源）
  │ createOpenNativeAIAgentService({ resolveAgentEngine })  ← node.ts 装配
  ▼
opennativeaiAgentService.createSession / v4 createSession / resume
  │ 读取 resolveAgentEngine() → 协议参数 agentEngine?: "default" | "lite"
  ▼
CLI 子进程（会话状态唯一所有者，不变）
  ├─ server-operations：sessionCreate/sessionResume params.agentEngine → runtimeConfig
  ├─ AgentRuntime.config.agentEngine → ContextBuilder（lite prompt 分支 + env Agent 行）
  │                                  → resolveBuiltInToolAllowlist（交集白名单）
  └─ v4 gateway / 持久化 / model-io / 权限：零改动复用
```

## 4. 接口定义（additive 可选字段）

- `opennativeaiSessionCreateParamsSchema` / `opennativeaiSessionResumeParamsSchema`（`packages/shared/src/opennativeai-protocol/index.ts`）新增 `agentEngine: z.enum(["default","lite"]).optional()`；缺席 = `"default"`。
- v4 `createSession` 命令 payload schema（`packages/shared/src/opennativeai-protocol-v4/command.ts`）新增同形字段。
- bootstrap 透传点：`server-operations.ts` 的 create/resume 处理器把 `params.agentEngine` 写入 `OpenNativeAIAppRuntimeConfigInput`；`runtime-config.ts` 随行；core `AgentRuntimeConfig` 新增同名字段。
- `LITE_TOOL_ALLOWLIST`（core `runtime/helpers/tool-allowlist.ts`）：`Bash、Read、Write、Edit、Grep、Glob`。与 localagent 参考实现的 9 工具映射：file_read/read_range→Read；edit_hunk→Edit；write_file→Write；bash/run_server/kill_server→Bash（CLI Bash 自带后台能力）；codegraph_search→Grep/Glob；run_tests→Bash。

## 5. Lite system prompt 组成（builder 分支）

保留段：cli_prefix、Lite identity（替换默认 identity）、dynamic behavior、env_info（`Agent:` 行动态）、current date、request user context（AGENTS.md 等用户指令）、context management。
跳过段：desktop context、session guidance、skills 列表、memory、output style。
Lite identity 用中文声明：Lite Agent（轻量级智能体，运行时标识 lite）、基础工具面、回复用中文——语义承接 `apps/opennativeai-cli/packages/localagent/src/orchestrator.ts` 的 SYSTEM_PROMPT。

## 6. model-io 与日志

换芯后 lite 会话跑在 CLI 内，model-io 由既有 `runner-debug.ts` 落盘（路径与 schema 不变，记忆 `11823aee`），日志查看器无感可用。原 PR-C（独立落盘器）取消。

## 7. 独立二进制退场

- `apps/opennativeai-cli/packages/localagent/` 保留为**参考实现**（orchestrator/tools/llm 的轻量循环语义来源）；`bin.ts` 维持 fail-fast exit 78，注释指向本 spec 说明方案已换芯、不再接线。
- `scripts/sync-localagent.mjs` 与 `pnpm localagent:check/apply` 保留但退出生产路径（root 源 `agent/liteagent/` 为存档；目录名与脚本期望的 `agent/localagent/` 不一致属已知状态，不修）。
- 原 spec §8 构建与暂存（`opennativeai-localagent.cjs`、`localagentEntry`）不实施。

## 8. 明确不做的事

- 不做 spawn 分派 / lane 复合进程 key / 第二二进制（原 §3、§5、§8 作废）。
- 不改 v4 协议结构，只加 additive 可选字段。
- resume 不做"按创建时引擎恢复"（引擎在 Host 侧不持久化）；恢复按当前设置取值， lite↔default 切换后旧会话恢复即换芯，属 v1 边界，UI 文案与验收场景 5 明示。
- 不改本地引擎本身（`packages/desktop/src/host/localEngine/**`）与主 CLI 云端默认链路。
- 不新增思考/推理参数透传（记忆 `271db3ab` 独立问题）。

## 9. 验收场景

1. 选 Lite → 新建会话：model-io 请求体 system prompt 含 Lite 声明、`Agent: lite` 行；`request.body.tools` 仅白名单 6 工具；流式、工具卡片、权限弹窗、停止与默认会话表现一致。
2. 切回 default → 新建会话：完整工具面与默认 prompt，零变化（回归）。
3. lite 会话中 CUA/显式 `toolAllowlist` 并存：最终注册面 = 显式 allowlist ∩ LITE 白名单（fail-closed，不放大）。
4. 旧 app-server 兼容：对不识别 `agentEngine` 的 CLI，create/resume 走 compat 降级重试成功，行为 = default。
5. 冷恢复/重开 lite 会话且设置仍为 lite：恢复后 prompt/工具面保持 lite；设置已切回 default 时恢复为 default（v1 边界）。
6. 身份问答：对 lite 会话问"你是什么智能体"，答 Lite Agent；default 会话答完整 CLI Agent。
7. 静态检查全绿：`pnpm typecheck`、`pnpm lint`、`pnpm fmt:check`、`pnpm architecture:check --changed`，CLI workspace 内 core/bootstrap tsc。

## 10. 交付切分（单次实施，按依赖序）

1. shared：协议 create/resume params + v4 createSession payload 加 `agentEngine`。
2. core：`AgentRuntimeConfig.agentEngine`、builder lite 分支（identity/env Agent 行动态/跳段）、`resolveBuiltInToolAllowlist` 交集。
3. bootstrap：server-operations create/resume 透传、`OpenNativeAIAppRuntimeConfigInput`、runtime-config 随行。
4. services：`resolveAgentEngine` 装配（node.ts 接 ISettingService）、create/v4/resume 三处下发、compat 字段集。
5. localagent bin.ts 退场注释；UI pendingNotice 文案改"已生效 + v1 边界"（zh/en）。
6. 测试：协议 schema 单测（接受 lite/拒绝非法值/缺席即 default）。
