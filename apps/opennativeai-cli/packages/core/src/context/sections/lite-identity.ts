// ============================================================
// Lite Agent Identity Section Builder
// ============================================================
// 换芯方案（docs/specs/localagent-protocol-adapter.md）：agentEngine="lite" 时替换
// buildIdentitySection 的稳定身份段。语义承接 localagent 参考实现的 SYSTEM_PROMPT
// （apps/opennativeai-cli/packages/localagent/src/orchestrator.ts），但只保留与
// 「引擎身份」相关的声明；其中 run_server/kill_server 专属规则不属于换芯工具面
// （CLI Bash 自带后台能力），不搬运。

import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";
import { buildHarnessBlock, buildSecurityNotice } from "./identity.js";

const LITE_IDENTITY_INTRO =
  "你是 Lite Agent（轻量级智能体，运行时标识 lite），一个集成在代码编辑器里的 AI 助手，运行在 OpenNativeAI 中。";
const LITE_IDENTITY_SELF_DECLARATION =
  "当用户询问你是什么智能体时，如实回答当前身份：Lite Agent（lite），与默认完整 CLI Agent（default）相区分。";
const LITE_IDENTITY_TOOLING =
  "你可以使用工具读取/修改文件、执行命令、检索代码。请尽量精准地完成任务。回复用中文。";

function buildLiteIdentityPrompt(): string {
  const identityLines = [
    "",
    LITE_IDENTITY_INTRO,
    LITE_IDENTITY_SELF_DECLARATION,
    "",
    LITE_IDENTITY_TOOLING,
    "",
    buildSecurityNotice(),
  ].join("\n");

  return [identityLines, "", buildHarnessBlock()].join("\n");
}

export function buildLiteAgentIdentitySection(): ContextSection {
  const content = buildLiteIdentityPrompt();

  return {
    name: "Lite Agent Identity",
    source: "identity",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
