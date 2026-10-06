import {
  isChatModelResponseFunctionCall,
  type ChatHistoryItem,
  type ChatModelFunctionCall,
  type ChatSessionModelFunctions,
  type GbnfJsonSchema,
} from "node-llama-cpp";
import type { EngineChatMessage, EngineTool } from "./engine.js";

/** 把 OpenAI messages 拆成 node-llama-cpp 历史 + 本次 prompt。 */
export function toChatHistory(messages: EngineChatMessage[]): {
  history: ChatHistoryItem[];
  prompt: string;
} {
  const history: ChatHistoryItem[] = [];
  let prompt = "";
  let lastContent = "";
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    const isLast = index === messages.length - 1;
    const content = normalizeContent(message.content);
    lastContent = content;
    if (message.role === "system") {
      history.push({ type: "system", text: content });
    } else if (message.role === "user") {
      // 修复：仅当 user 处于消息数组末尾时才作为本次 prompt。
      // 若其后还跟着 assistant 工具调用 + tool 结果（本轮 agentic 工具往返），
      // 则把该 user 作为历史保留，避免只留 prompt 而把工具结果挤出上下文，
      // 使本地模型能基于工具结果继续（此前会把工具结果当没有，误判“工具返回空”）。
      if (isLast) {
        prompt = content;
      } else {
        history.push({ type: "user", text: content });
      }
    } else if (message.role === "assistant") {
      const response: Array<string | ChatModelFunctionCall> = [];
      if (content) {
        response.push(content);
      }
      for (const toolCall of message.tool_calls ?? []) {
        response.push({
          type: "functionCall",
          name: toolCall.function.name,
          params: safeParse(toolCall.function.arguments),
          result: undefined,
        });
      }
      history.push({ type: "model", response });
    } else if (message.role === "tool") {
      // tool 结果回填到最近一个 functionCall 的 result，保持 function-calling 往返。
      const lastModel = history[history.length - 1];
      if (lastModel && lastModel.type === "model") {
        const calls = lastModel.response.filter((item): item is ChatModelFunctionCall =>
          isChatModelResponseFunctionCall(item),
        );
        const target = calls[calls.length - 1];
        if (target) {
          target.result = safeParse(content || "null");
        }
      }
    }
  }
  // agentic 续写：末尾不是 user 消息（如 tool 结果后要求模型继续）时，
  // ChatSession 仍需一个 prompt 才能生成，退化为最后一条内容，避免空 prompt 直接返回空。
  if (prompt === "") {
    prompt = lastContent;
  }
  return { history, prompt };
}

/** 归一 OpenAI 消息 content：兼容 string、content parts 数组与 null。 */
export function normalizeContent(content: string | unknown[] | null): string {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          const record = part as Record<string, unknown>;
          if (typeof record.text === "string") {
            return record.text;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  return String(content);
}

function safeParse(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** OpenAI tools → node-llama-cpp ChatSessionModelFunctions。handler 仅收集调用，不本地执行。 */
export function buildFunctions(tools: EngineTool[]): ChatSessionModelFunctions | undefined {
  if (tools.length === 0) {
    return undefined;
  }
  const functions: Record<string, ChatSessionModelFunctions[string]> = {};
  for (const tool of tools) {
    const fn = tool.function;
    if (!fn?.name) continue;
    functions[fn.name] = {
      description: fn.description ?? fn.name,
      // OpenAI 的 JSON Schema 与 node-llama-cpp 的 GbnfJsonSchema 高度兼容，这里直接透传。
      params: (fn.parameters as GbnfJsonSchema | undefined) ?? undefined,
      // 引擎不代为执行工具：返回占位，真实执行由 CLI/Agent 侧完成，
      // promptWithMeta 会把该 functionCall 作为停止项回传给上层转成 tool_calls。
      handler: () => ({}),
    };
  }
  return functions;
}

/** 浅拷贝消息数组（content 会被就地改写，重试需隔离副本）。 */
export function cloneMessages(messages: EngineChatMessage[]): EngineChatMessage[] {
  return messages.map((m) => ({ ...m }));
}

/**
 * 本地基础工具白名单：只保留最基础的文件/命令操作，砍掉 Agent/Skill/Todo/Cron/OffPeak 等体积巨大的可选工具 schema。
 * 置为空集合表示不限制（保留全部），便于后续按需调整。
 */
const LOCAL_BASIC_TOOL_NAMES = new Set(["Read", "Write", "Edit", "Bash", "Grep", "Glob"]);

/** 过滤到本地基础工具白名单。 */
export function filterLocalBasicTools(tools: EngineTool[]): EngineTool[] {
  if (LOCAL_BASIC_TOOL_NAMES.size === 0) {
    return tools;
  }
  return tools.filter((tool) => LOCAL_BASIC_TOOL_NAMES.has(tool.function?.name ?? ""));
}

/**
 * 本地最小上下文：保留 system + 「当前这一轮」的消息（最后一条 user 及其之后的 assistant 工具调用与 tool 结果），
 * 只丢弃更早的历史轮次。
 * 修复依据：此前只留 system + 最后一条 user，会把本轮的 tool 结果一并删掉，
 * 导致 agentic 工具循环里模型永远看不到工具输出（表现为“工具返回空/环境坏了”的误判）。
 * 本地模型仍不承载多轮长历史，但必须保留本轮工具往返才能基于结果继续。
 */
export function toLocalMinimalMessages(messages: EngineChatMessage[]): EngineChatMessage[] {
  const system = messages.filter((m) => m.role === "system").map((m) => ({ ...m }));
  // 从后往前找最后一条 user 的下标；从它到结尾整段保留（当前轮的 user → assistant(tool_calls) → tool 结果链）。
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex >= 0) {
    const currentTurn = messages
      .slice(lastUserIndex)
      .filter((m) => m.role !== "system")
      .map((m) => ({ ...m }));
    return [...system, ...currentTurn];
  }
  // 没有 user 消息（纯工具续写等罕见情况）：保留 system + 从第一条非 system 消息起的整段，保证不丢工具结果。
  const tailStart = messages.findIndex((m) => m.role !== "system");
  const tail = tailStart >= 0 ? messages.slice(tailStart).map((m) => ({ ...m })) : [];
  return [...system, ...tail];
}

/** 降级到最小形态：仅保留最后一条 user 消息（无则取最后一条），保证总能塞进上下文。 */
export function minimizeToLastUser(messages: EngineChatMessage[]): EngineChatMessage[] {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser) {
    return [{ ...lastUser }];
  }
  const last = messages[messages.length - 1];
  return last ? [{ ...last }] : [];
}

/** 判断异常是否为 node-llama-cpp 的上下文溢出（而非真正的推理/中断错误）。 */
export function isContextOverflowError(error: unknown): boolean {
  const message = String((error as { message?: string } | undefined)?.message ?? error ?? "");
  return /context shift|too long|does not fit|cannot be compressed|context size|Failed to compress|compress chat history/i.test(
    message,
  );
}

/**
 * 工具调用参数校验结果：
 * - valid：合法调用（包含字段非空的 required）
 * - invalid：非法调用，附缺缺原因，会回注为文本提示模型下一轮重试
 */
export interface ValidatedToolCalls {
  valid: Array<{ id: string; name: string; arguments: string }>;
  invalid: Array<{ name: string; missing: string[]; raw: string }>;
}

/**
 * 对开头回注的 nudge 文本。写中文、直白地告诉模型“哪个工具的哪些字段没填”，
 * 让下一轮自己修正；避免模型把空参数当成“工具坏了/沙箱吞输出”幻觉的根因。
 * 修复依据：记忆 `63ca63e4`、`0f7e626e`，小模型 function-calling 不稳。
 */
export function buildToolCallCheckNudge(invalid: ValidatedToolCalls["invalid"]): string {
  if (invalid.length === 0) return "";
  const lines = invalid.map((item) => {
    const missing = item.missing.join(", ");
    return `${item.name} 缺必填参数: ${missing}（收到的 arguments=${item.raw || ""}）。请重新调用并在参数里填入具体值。`;
  });
  return `[本地引擎参数校验] 上一轮工具调用被丢弃，因为必填字段为空。\n${lines.join("\n")}`;
}

/** JSON Schema 里“空值”的统一判定：undefined/null/空串/空对象/空数组 都算空。 */
function isEmptyRequiredValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

/**
 * 按 tools schema 校验模型返回的 tool_calls，丢弃缺 required 字段的调用。
 * 不直接报错，而是拆成 valid + invalid 两部分，上层把 invalid 回注为自然语言提示，
 * 让模型在下一轮自己修正；valid 部分正常下发到 CLI。
 * 没有 schema 匹配的工具（例如工具名不在白名单）当作合法，不阻断主链路。
 */
export function validateToolCallsAgainstSchema(
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
  tools: EngineTool[],
): ValidatedToolCalls {
  const schemaByName = new Map<string, string[]>();
  for (const tool of tools) {
    const fn = tool.function;
    if (!fn?.name) continue;
    const params = fn.parameters as { required?: unknown } | undefined;
    const rawRequired = params ? params.required : undefined;
    const required = Array.isArray(rawRequired)
      ? rawRequired.filter((x): x is string => typeof x === "string")
      : [];
    schemaByName.set(fn.name, required);
  }
  const valid: ValidatedToolCalls["valid"] = [];
  const invalid: ValidatedToolCalls["invalid"] = [];
  for (const call of toolCalls) {
    const required = schemaByName.get(call.name);
    if (!required || required.length === 0) {
      valid.push(call);
      continue;
    }
    let parsed: Record<string, unknown> | null = null;
    try {
      const raw = JSON.parse(call.arguments || "null") as unknown;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        parsed = raw as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }
    const missing: string[] = [];
    for (const field of required) {
      if (!parsed || isEmptyRequiredValue(parsed[field])) missing.push(field);
    }
    if (missing.length > 0) {
      invalid.push({ name: call.name, missing, raw: call.arguments });
    } else {
      valid.push(call);
    }
  }
  return { valid, invalid };
}
