import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { filterLocalBasicTools } from "./engineMessages.js";
import type { EngineChatMessage, EngineTool, LocalLlamaEngine } from "./engine.js";

/**
 * 从工具列表提取本地引擎实际保留的工具名，供 model-io 查看器区分
 * 「CLI 准备的全量工具」与「本地模型真正可用的工具」。
 * 过滤逻辑与 engine.generate 内部的 filterLocalBasicTools 一致（幂等）。
 */
function localFilteredToolNames(tools: EngineTool[] | undefined): string {
  if (!tools || tools.length === 0) return "";
  return filterLocalBasicTools(tools)
    .map((t) => t.function?.name)
    .filter(Boolean)
    .join(",");
}

/** 已启动的本地服务句柄：暴露端口与关闭函数。 */
export interface OpenAiServerHandle {
  port: number;
  baseUrl: string;
  close(): Promise<void>;
}

export interface OpenAiServerOptions {
  engine: LocalLlamaEngine;
  modelId: string;
  defaultTemperature: number;
  /**
   * 优先监听的固定端口。本地引擎的 provider baseUrl 会随 registry 落盘持久化，
   * 若每次用系统随机端口，进程重启后旧端口即失效，CLI 打到死端口会表现为 empty_model_response；
   * 固定端口使持久化的 baseUrl 跨重启保持稳定。端口被占用时自动回退到系统分配端口。
   */
  port?: number;
  /** 解析/推理失败时的可诊断日志回调。 */
  onError?: (error: unknown, context: string) => void;
  /** 高频诊断（原始请求形状 / 生成结果），仅 debug 级别，生产不落盘。 */
  debug?: (message: string, data?: Record<string, unknown>) => void;
  /** 模型返回空内容时的告警回调（warn 级，保证 dev 控制台可见），携带诊断摘要。 */
  onEmpty?: (summary: Record<string, unknown>) => void;
}

interface ChatCompletionRequest {
  model?: string;
  messages?: EngineChatMessage[];
  tools?: EngineTool[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

/**
 * 仅监听 127.0.0.1 的最小 OpenAI 兼容服务，把 /v1/chat/completions 与 /v1/models
 * 翻译成 node-llama-cpp 引擎调用，使本地 GGUF 能作为自定义 provider 复用现有 CLI 执行链。
 */
export async function startOpenAiServer(options: OpenAiServerOptions): Promise<OpenAiServerHandle> {
  const { engine, modelId, defaultTemperature, onError, debug, onEmpty } = options;
  const created = Date.now();

  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      onError?.(error, "openai-server-request");
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: { message: String(error) } }));
    });
  });

  // 端口优先用固定值，使持久化的 provider baseUrl 跨进程重启保持稳定（随机端口重启后变死端口，
  // 导致 CLI 打到旧端口报 empty_model_response）。固定端口被占用时回退系统随机端口，保证服务仍能起来。
  const preferredPort = options.port;
  await new Promise<void>((resolve, reject) => {
    const onListenError = (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" && preferredPort !== undefined) {
        server.removeListener("error", onListenError);
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
        return;
      }
      reject(error);
    };
    server.once("error", onListenError);
    server.listen(preferredPort ?? 0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  const port = address.port;

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? "";
    if (req.method === "GET" && (url === "/v1/models" || url.startsWith("/v1/models?"))) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: modelId, object: "model", created, owned_by: "local-text-engine" }],
        }),
      );
      return;
    }

    if (req.method === "POST" && url === "/v1/chat/completions") {
      const body = await readJson(req);
      const parsed = (body ?? {}) as ChatCompletionRequest;
      const messages = parsed.messages ?? [];
      const temperature = parsed.temperature ?? defaultTemperature;
      const id = `chatcmpl-${randomUUID()}`;
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      debug?.("chat/completions request", {
        model: parsed.model,
        stream: Boolean(parsed.stream),
        messageCount: messages.length,
        roles: messages.map((m) => m.role),
        lastUserContentType: Array.isArray(lastUser?.content) ? "array" : typeof lastUser?.content,
        toolCount: parsed.tools?.length ?? 0,
        temperature,
      });
      if (parsed.stream) {
        await streamCompletion(res, {
          engine,
          modelId,
          messages,
          tools: parsed.tools,
          temperature,
          id,
          created,
          onError,
          debug,
          onEmpty,
        });
      } else {
        await jsonCompletion(res, {
          engine,
          modelId,
          messages,
          tools: parsed.tools,
          temperature,
          id,
          created,
          onError,
          debug,
          onEmpty,
        });
      }
      return;
    }

    debug?.("unhandled request", { method: req.method, url });
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  }

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

interface CompletionContext {
  engine: LocalLlamaEngine;
  modelId: string;
  messages: EngineChatMessage[];
  tools?: EngineTool[];
  temperature: number;
  id: string;
  created: number;
  onError?: (error: unknown, context: string) => void;
  debug?: (message: string, data?: Record<string, unknown>) => void;
  onEmpty?: (summary: Record<string, unknown>) => void;
}

/** 空回复时构造诊断摘要：角色序列、末条 user content 类型、实际 prompt 长度与停止原因。 */
function buildEmptySummary(
  ctx: CompletionContext,
  result: { promptLength: number; stopReason: string },
): Record<string, unknown> {
  const lastUser = [...ctx.messages].reverse().find((m) => m.role === "user");
  return {
    model: ctx.modelId,
    messageCount: ctx.messages.length,
    roles: ctx.messages.map((m) => m.role),
    lastUserContentType: Array.isArray(lastUser?.content) ? "array" : typeof lastUser?.content,
    promptLength: result.promptLength,
    stopReason: result.stopReason,
    toolCallCount: 0,
  };
}

async function jsonCompletion(res: http.ServerResponse, ctx: CompletionContext): Promise<void> {
  const result = await ctx.engine.generate({
    messages: ctx.messages,
    ...(ctx.tools ? { tools: ctx.tools } : {}),
    temperature: ctx.temperature,
    onDowngrade: (note) => ctx.debug?.("generate downgrade", { note }),
  });
  ctx.debug?.("generate result", {
    contentLength: result.content.length,
    toolCallCount: result.toolCalls.length,
  });
  if (result.content.trim() === "" && result.toolCalls.length === 0) {
    ctx.onEmpty?.(buildEmptySummary(ctx, result));
  }
  const finishReason = result.toolCalls.length > 0 ? "tool_calls" : "stop";
  const message: Record<string, unknown> = {
    role: "assistant",
    content: result.content.length > 0 ? result.content : null,
  };
  if (result.toolCalls.length > 0) {
    message.tool_calls = result.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  res.writeHead(200, {
    "content-type": "application/json",
    "x-localengine-filtered-tools": localFilteredToolNames(ctx.tools),
  });
  res.end(
    JSON.stringify({
      id: ctx.id,
      object: "chat.completion",
      created: ctx.created,
      model: ctx.modelId,
      choices: [{ index: 0, message, finish_reason: finishReason }],
    }),
  );
}

async function streamCompletion(res: http.ServerResponse, ctx: CompletionContext): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-localengine-filtered-tools": localFilteredToolNames(ctx.tools),
  });
  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  // 首个 delta 建立 assistant 角色帧，贴合 OpenAI SSE 约定。
  send({
    id: ctx.id,
    object: "chat.completion.chunk",
    created: ctx.created,
    model: ctx.modelId,
    choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
  });
  // 兜底：若引擎未触发 onTextChunk 但确实生成了文本，补发一个完整 content delta，避免流式下丢内容。
  let streamed = false;
  const result = await ctx.engine.generate({
    messages: ctx.messages,
    ...(ctx.tools ? { tools: ctx.tools } : {}),
    temperature: ctx.temperature,
    onDowngrade: (note) => ctx.debug?.("generate downgrade", { note }),
    onTextChunk: (text) => {
      streamed = true;
      send({
        id: ctx.id,
        object: "chat.completion.chunk",
        created: ctx.created,
        model: ctx.modelId,
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
      });
    },
  });
  ctx.debug?.("stream generate result", {
    contentLength: result.content.length,
    toolCallCount: result.toolCalls.length,
    streamed,
  });
  if (result.content.trim() === "" && result.toolCalls.length === 0) {
    ctx.onEmpty?.(buildEmptySummary(ctx, result));
  }
  if (!streamed && result.content.length > 0) {
    send({
      id: ctx.id,
      object: "chat.completion.chunk",
      created: ctx.created,
      model: ctx.modelId,
      choices: [{ index: 0, delta: { content: result.content }, finish_reason: null }],
    });
  }
  if (result.toolCalls.length > 0) {
    send({
      id: ctx.id,
      object: "chat.completion.chunk",
      created: ctx.created,
      model: ctx.modelId,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: result.toolCalls.map((call) => ({
              index: 0,
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            })),
          },
          finish_reason: "tool_calls",
        },
      ],
    });
  } else {
    send({
      id: ctx.id,
      object: "chat.completion.chunk",
      created: ctx.created,
      model: ctx.modelId,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (raw.trim() === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
