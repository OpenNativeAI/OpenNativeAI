/**
 * LLM 流式客户端（纯 TS 实现）
 *
 * 支持 OpenAI 兼容 / Gemini（OpenAI 兼容端点）/ Anthropic 三种协议，
 * 用原生 fetch 解析 SSE，把工具调用增量累积后随结果返回。
 *
 * 上层把 provider 配置（model_identifier / api_format / endpoint_url / api_key）
 * 透传进来，字段 snake_case 与 orchestrator 保持一致。
 */

import { classifyFetchError, classifyHttpError, classifyStreamError, tagError } from "./errors.js";

export interface ModelConfig {
  model_identifier: string;
  api_format: string; // openai / anthropic / gemini / custom
  endpoint_url?: string | null;
  api_key?: string | null;
}

export interface LlmToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ChatMsg {
  role: string; // user | assistant | tool
  content: string;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string | null;
}

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatOutcome {
  text: string;
  thinking?: string;
  tool_calls: LlmToolCall[];
  usage?: TokenUsage;
  elapsed_ms?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
}

const OPENAI_BASE = "https://api.openai.com/v1";
const ANTHROPIC_BASE = "https://api.anthropic.com";
const GEMINI_OPENAI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

function openaiUrl(cfg: ModelConfig, defaultBase: string): string {
  const base = (cfg.endpoint_url ?? "").trim() || defaultBase;
  const trimmed = base.replace(/\/$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function anthropicUrl(cfg: ModelConfig): string {
  const base = (cfg.endpoint_url ?? "").trim() || ANTHROPIC_BASE;
  const trimmed = base.replace(/\/$/, "");
  return trimmed.endsWith("/messages") ? trimmed : `${trimmed}/v1/messages`;
}

function openaiMessages(system: string, history: ChatMsg[]): unknown[] {
  const msgs: unknown[] = [{ role: "system", content: system }];
  for (const m of history) {
    if (m.role === "assistant") {
      const hasTools = !!(m.tool_calls && m.tool_calls.length);
      // 协议:assistant 带 tool_calls 时 content 应为 null(OpenAI 推荐),避免本地模型把 "" 误读为"任务结束"
      const v: Record<string, unknown> = {
        role: "assistant",
        content: hasTools && !m.content ? null : m.content,
      };
      if (m.tool_calls && m.tool_calls.length) {
        v["tool_calls"] = m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        }));
      }
      msgs.push(v);
    } else if (m.role === "tool") {
      msgs.push({
        role: "tool",
        tool_call_id: m.tool_call_id ?? "",
        content: m.content,
      });
    } else {
      msgs.push({ role: "user", content: m.content });
    }
  }
  return msgs;
}

function anthropicMessages(history: ChatMsg[]): unknown[] {
  const msgs: { role: string; content: unknown[] }[] = [];
  const pushBlocks = (role: string, blocks: unknown[]) => {
    const last = msgs[msgs.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) {
      last.content.push(...blocks);
      return;
    }
    msgs.push({ role, content: blocks });
  };
  for (const m of history) {
    if (m.role === "assistant") {
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls ?? []) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
      }
      if (blocks.length) pushBlocks("assistant", blocks);
    } else if (m.role === "tool") {
      pushBlocks("user", [
        { type: "tool_result", tool_use_id: m.tool_call_id ?? "", content: m.content },
      ]);
    } else {
      pushBlocks("user", [{ type: "text", text: m.content }]);
    }
  }
  return msgs;
}

function openaiTools(tools: ToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function anthropicTools(tools: ToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

interface PartialCall {
  id: string;
  name: string;
  args_buf: string;
}

function finishCall(pc: PartialCall): LlmToolCall {
  let args: unknown = {};
  if (pc.args_buf.trim()) {
    try {
      args = JSON.parse(pc.args_buf);
    } catch {
      args = {};
    }
  }
  return { id: pc.id || cryptoRandom(), name: pc.name, args };
}

function cryptoRandom(): string {
  return "call-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

interface AnthropicStreamChunk {
  type?: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
}

export async function streamChat(
  cfg: ModelConfig,
  system: string,
  history: ChatMsg[],
  tools: ToolDefinition[],
  cancel: { cancelled: boolean },
  onToken: (t: string) => void,
  onThinking?: (t: string) => void,
): Promise<ChatOutcome> {
  const isAnthropic = cfg.api_format.toLowerCase() === "anthropic";

  let body: Record<string, unknown>;
  let url: string;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (isAnthropic) {
    body = {
      model: cfg.model_identifier,
      system,
      messages: anthropicMessages(history),
      max_tokens: 8192,
      stream: true,
    };
    if (tools.length) body["tools"] = anthropicTools(tools);
    url = anthropicUrl(cfg);
    headers["x-api-key"] = cfg.api_key ?? "";
    headers["anthropic-version"] = "2023-06-01";
  } else {
    const defaultBase =
      cfg.api_format.toLowerCase() === "gemini" ? GEMINI_OPENAI_BASE : OPENAI_BASE;
    body = {
      model: cfg.model_identifier,
      messages: openaiMessages(system, history),
      stream: true,
    };
    if (tools.length) body["tools"] = openaiTools(tools);
    url = openaiUrl(cfg, defaultBase);
    headers["authorization"] = `Bearer ${cfg.api_key ?? ""}`;
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: cancel.cancelled ? AbortSignal.abort() : undefined,
    });
  } catch (err) {
    throw tagError(new Error("fetch failed"), classifyFetchError(err, cfg.model_identifier));
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw tagError(
      new Error(`LLM HTTP ${resp.status}`),
      classifyHttpError(resp.status, text.slice(0, 500), cfg.model_identifier),
    );
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  let thinkingBuf = "";
  let usage: TokenUsage | undefined;
  const startedAt = now();
  const partials = new Map<number, PartialCall>();

  while (true) {
    if (cancel.cancelled) {
      throw tagError(
        new Error("cancelled"),
        classifyFetchError({ name: "AbortError" }, cfg.model_identifier),
      );
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let pos: number;
    while ((pos = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, pos).trim();
      buf = buf.slice(pos + 1);
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      if (isAnthropic) {
        let v: AnthropicStreamChunk;
        try {
          v = JSON.parse(data) as AnthropicStreamChunk;
        } catch {
          continue;
        }
        switch (v.type) {
          case "content_block_start": {
            const idx = v.index ?? 0;
            const block = v.content_block ?? {};
            if (block.type === "tool_use") {
              partials.set(idx, { id: block.id ?? "", name: block.name ?? "", args_buf: "" });
            }
            break;
          }
          case "content_block_delta": {
            const idx = v.index ?? 0;
            const delta = v.delta ?? {};
            if (delta.type === "text_delta" && delta.text) {
              full += delta.text;
              onToken(delta.text);
            } else if (delta.type === "thinking" && delta.thinking) {
              thinkingBuf += delta.thinking;
              onThinking?.(delta.thinking);
            } else if (delta.type === "input_json_delta" && delta.partial_json) {
              const pc = partials.get(idx);
              if (pc) pc.args_buf += delta.partial_json;
            }
            break;
          }
          case "message_delta": {
            const u = v.usage;
            if (u) {
              usage = {
                prompt_tokens: u.input_tokens,
                completion_tokens: u.output_tokens,
                total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
              };
            }
            break;
          }
          case "error":
            throw new Error(`LLM stream error: ${v.error?.message ?? "unknown"}`);
          default:
            break;
        }
      } else {
        let v: OpenAIStreamChunk;
        try {
          v = JSON.parse(data) as OpenAIStreamChunk;
        } catch {
          continue;
        }
        const delta = v.choices?.[0]?.delta ?? {};
        if (delta.content) {
          full += delta.content;
          onToken(delta.content);
        }
        // OpenAI 兼容 / Gemini:reasoning_content(DeepSeek、o-series、QwQ 等)
        if (delta.reasoning_content) {
          thinkingBuf += delta.reasoning_content;
          onThinking?.(delta.reasoning_content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const c of delta.tool_calls) {
            const idx = c.index ?? 0;
            let pc = partials.get(idx);
            if (!pc) {
              pc = { id: "", name: "", args_buf: "" };
              partials.set(idx, pc);
            }
            if (c.id) pc.id += c.id;
            if (c.function?.name) pc.name += c.function.name;
            if (c.function?.arguments) pc.args_buf += c.function.arguments;
          }
        }
        if (v.error?.message) {
          throw tagError(
            new Error(v.error.message),
            classifyStreamError(v.error.message, cfg.model_identifier),
          );
        }
        if (v.usage) {
          usage = {
            prompt_tokens: v.usage.prompt_tokens,
            completion_tokens: v.usage.completion_tokens,
            total_tokens: v.usage.total_tokens,
          };
        }
      }
    }
  }

  const toolCalls = [...partials.values()].filter((p) => p.name).map(finishCall);
  const endedAt = now();
  return {
    text: full,
    thinking: thinkingBuf || undefined,
    tool_calls: toolCalls,
    usage,
    elapsed_ms: Math.max(0, Math.round(endedAt - startedAt)),
  };
}
