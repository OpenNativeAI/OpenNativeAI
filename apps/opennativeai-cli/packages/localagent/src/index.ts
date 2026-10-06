/**
 * Local Agent 公共入口。
 *
 * 语义：把 agent 循环的所有权交给一个"独立子进程"的 orchestrator，
 * 只有当会话 provider 命中桌面本地文本引擎时才会被 spawn。云端 API
 * 仍走原有的 CLI Agent 子进程，不受影响。
 */
export {
  startSession,
  setModel,
  cancelTurn,
  cancelSession,
  resolvePermission,
  send,
  setEmitter,
  setDefaultModelProvider,
  type AgentEvent,
  type AgentMode,
  type SessionState,
} from "./orchestrator.js";
export { toolDefs, executeTool, cleanupServers, killServer, type ToolResult } from "./tools.js";
export type { ChatMsg, ChatOutcome, ModelConfig, ToolDefinition, LlmToolCall } from "./llm.js";
export type { LlmErrorCode, LlmErrorInfo } from "./errors.js";
