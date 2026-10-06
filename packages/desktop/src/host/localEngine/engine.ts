import path from "node:path";
import type { LocalEngineModelInfo } from "@opennativeai/shared";
import {
  LlamaChatSession,
  LlamaLogLevel,
  getLlama,
  isChatModelResponseFunctionCall,
  type ChatModelFunctionCall,
  type LlamaContext,
  type LlamaContextSequence,
  type LlamaModel,
} from "node-llama-cpp";
import { buildModelInfo } from "./engineInfo.js";
import {
  buildFunctions,
  buildToolCallCheckNudge,
  cloneMessages,
  filterLocalBasicTools,
  isContextOverflowError,
  minimizeToLastUser,
  normalizeContent,
  toChatHistory,
  toLocalMinimalMessages,
  validateToolCallsAgainstSchema,
} from "./engineMessages.js";

/** OpenAI chat/completions 的单条消息（仅取引擎映射所需字段）。 */
export interface EngineChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /**
   * OpenAI 消息内容：agentic 客户端（AI SDK / OpenNativeAI CLI）常以 content parts 数组下发
   * （如 [{type:"text", text:"…"}]），不能假定一定是字符串，统一经 normalizeContent 归一。
   */
  content: string | unknown[] | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

/** OpenAI function-calling 工具声明。 */
export interface EngineTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** 引擎一次生成的结果：文本内容 + 归一化后的 tool_calls + 诊断字段。 */
export interface EngineGenerateResult {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  /** 实际喂给模型的 prompt 字符长度（诊断空回复用）。 */
  promptLength: number;
  /** node-llama-cpp 停止原因（eogToken/maxTokens/abort/functionCalls 等）。 */
  stopReason: string;
}

export interface EngineGenerateOptions {
  messages: EngineChatMessage[];
  tools?: EngineTool[];
  temperature: number;
  maxTokens?: number;
  /** 流式文本回调；服务端据此写 SSE chunk。 */
  onTextChunk?: (text: string) => void;
  /** 因上下文溢出而降级重试时的说明回调（供服务端日志）。 */
  onDowngrade?: (note: string) => void;
  signal?: AbortSignal;
}

export interface EngineLoadParams {
  modelPath: string;
  contextLength: number;
  threads: number;
  gpuEnabled: boolean;
  /** 常驻内存：true 时以 useMlock 加载，强制把模型页钉在 RAM/VRAM。 */
  keepInMemory: boolean;
}

/**
 * node-llama-cpp 封装：加载单个 GGUF 模型、创建 context/sequence/session，
 * 并把一次 OpenAI 风格的 messages+tools 请求翻译成 ChatSession 推理。
 *
 * 只在桌面本地 Host（Node 进程）实例化；Renderer 不接触这层。
 */
export class LocalLlamaEngine {
  #model: LlamaModel | undefined;
  #context: LlamaContext | undefined;
  #sequence: LlamaContextSequence | undefined;
  /** 本次加载是否开启 mlock（供 getInfo 回显“常驻内存”实际值）。 */
  #keepInMemory = false;
  readonly modelId: string;

  constructor(params: EngineLoadParams) {
    // modelId 用模型文件名（去扩展名），作为注册进 provider registry 的稳定标识。
    this.modelId = path.basename(params.modelPath, path.extname(params.modelPath)) || "local-model";
  }

  get loaded(): boolean {
    return this.#model !== undefined;
  }

  /** 加载模型与上下文；首次加载大模型较慢，调用方需异步等待并给 UI 状态反馈。 */
  async load(params: EngineLoadParams): Promise<void> {
    const llama = await getLlama({
      // GPU 关闭时显式 false，只用 CPU；开启时用 auto（macOS 走 Metal）。
      gpu: params.gpuEnabled ? "auto" : false,
      // 引擎原始日志降噪，只保留 error，避免污染 Host 生产日志。
      logLevel: LlamaLogLevel.error,
    });
    // 常驻内存（mlock）：强制把模型页钉在 RAM/VRAM，避免闲置后被系统逐出导致首次/闲置后卡顿。
    // 不会缩短首次 loadModel 读盘耗时，大模型开启会固定占用较多内存，故由用户显式开关、默认关。
    this.#keepInMemory = params.keepInMemory;
    const model = await llama.loadModel({
      modelPath: params.modelPath,
      useMlock: params.keepInMemory,
    });
    this.#model = model;
    const context = await model.createContext({
      contextSize: params.contextLength,
    });
    this.#context = context;
    this.#sequence = context.getSequence();
  }

  /** 释放模型与上下文原生资源；stop 时调用，避免常驻占用内存。 */
  async dispose(): Promise<void> {
    this.#sequence = undefined;
    this.#context?.dispose();
    this.#context = undefined;
    this.#model?.dispose();
    this.#model = undefined;
  }

  /**
   * 采集运行时/模型详情（供设置面板展示）。仅在模型已加载时有意义（未加载返回 undefined）。
   * 每个字段独立读取并吞掉异常：不同架构/量化文件的 getter 可能不可用，取不到就省略，绝不伪造数值。
   * 内存（RAM/VRAM）为 node-llama-cpp 估算值，模型 + 上下文合并统计。
   */
  getInfo(): LocalEngineModelInfo | undefined {
    const model = this.#model;
    if (!model) {
      return undefined;
    }
    return buildModelInfo(model, this.#context, this.#keepInMemory);
  }

  /**
   * 生成一次回复。
   * 每次请求用独立 ChatSession：先把历史消息灌入 setChatHistory，再对最后一条 user 消息
   * prompt，保证 OpenAI 无状态请求语义；工具经 ChatSessionModelFunctions 映射。
   */
  async generate(options: EngineGenerateOptions): Promise<EngineGenerateResult> {
    const sequence = this.#sequence;
    if (!sequence) {
      throw new Error("本地引擎尚未加载模型");
    }
    const {
      messages,
      tools = [],
      temperature,
      maxTokens,
      onTextChunk,
      onDowngrade,
      signal,
    } = options;

    // 本地最小请求策略（本引擎只服务本地 GGUF 模型，故对所有请求生效）：
    // 蒸馏/量化小模型既扛不住完整 Agent 的 system + 几十个工具 schema + 长历史，也普遍不可靠支持全量 function-calling。
    // 为彻底避免上下文溢出（曾表现为 500 → CLI 伪装 empty_model_response），默认把请求收敛为：
    // 工具只保留最基础白名单、不携带多轮历史（仅 system + 最新一条 user）。
    const baseMessages = toLocalMinimalMessages(messages);
    const baseTools = filterLocalBasicTools(tools);

    // 降级重试阶梯：即便已收敛为最小请求，若仍撞上下文溢出（node-llama-cpp 抛“context shift strategy did not fit / system too long”），
    // 直接透出会变成 500 → CLI 伪装成 empty_model_response。这里逐级缩减后重试，优先保证“能回话”而非崩溃：
    // 完整（仅裁 system）→ 去工具 → 仅保留最新 user。每次重试前都先 fitSystemMessagesToContext 裁 system。
    const attempts: Array<{ messages: EngineChatMessage[]; tools: EngineTool[] }> = [
      { messages: cloneMessages(baseMessages), tools: baseTools },
      { messages: cloneMessages(baseMessages), tools: [] },
      { messages: cloneMessages(minimizeToLastUser(baseMessages)), tools: [] },
    ];

    let lastError: unknown;
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      if (!attempt) {
        break;
      }
      // 流式一旦开始向客户端发块就不能重试（会重复内容）；上下文溢出发生在生成前，正常不会置位。
      let streamed = false;
      const chunk = onTextChunk
        ? (text: string) => {
            streamed = true;
            onTextChunk(text);
          }
        : undefined;
      const session = new LlamaChatSession({ contextSequence: sequence });
      try {
        this.fitSystemMessagesToContext(attempt.messages, attempt.tools, maxTokens);
        const { history, prompt } = toChatHistory(attempt.messages);
        if (history.length > 0) {
          session.setChatHistory(history);
        }
        const functions = buildFunctions(attempt.tools);
        const meta = await session.promptWithMeta(prompt, {
          temperature,
          ...(maxTokens !== undefined ? { maxTokens } : {}),
          ...(signal ? { signal } : {}),
          ...(chunk ? { onTextChunk: chunk } : {}),
          ...(functions ? { functions } : {}),
        });
        const rawToolCalls = (meta.response ?? [])
          .filter((item): item is ChatModelFunctionCall => isChatModelResponseFunctionCall(item))
          .map((call, index) => ({
            id: `call_${index}`,
            name: call.name,
            arguments: JSON.stringify(call.params ?? {}),
          }));
        // 空/非法参数拒收：小模型 (9B Q4) 在零推理预算下常吐 `{name:"Bash", arguments:"{}"}`，
        // 直接下发会让 CLI 抛 inputSchema validation，模型下一轮又幻觉“工具坏了/沙箱吞输出”。
        // 这里按当前工具的 JSON Schema required 字段过滤，将非法调用丢弃，
        // 并把自然语言提示回注到 content 开头，让模型下一轮看到失败原因后自己修正。
        const validated = validateToolCallsAgainstSchema(rawToolCalls, attempt.tools);
        const nudge = buildToolCallCheckNudge(validated.invalid);
        const content =
          nudge.length > 0
            ? `${nudge}\n\n${meta.responseText ?? ""}`.trim()
            : (meta.responseText ?? "");
        return {
          content,
          toolCalls: validated.valid,
          promptLength: prompt.length,
          stopReason: meta.stopReason,
        };
      } catch (error) {
        lastError = error;
        // 非上下文溢出、或已中断、或已开始流式 → 不能安全重试，直接上抛。
        if (signal?.aborted || streamed || !isContextOverflowError(error)) {
          throw error;
        }
        // 上下文溢出：换下一级降级继续，并记录本次降级做了什么（便于日志与排查）。
        const next = attempts[i + 1];
        if (next && onDowngrade) {
          const dropped = attempt.tools.length > 0 && next.tools.length === 0 ? "移除工具定义" : "";
          const minimized =
            attempt.messages.length > next.messages.length ? "仅保留最新用户消息" : "";
          onDowngrade(
            `上下文溢出，降级重试 #${i + 2}${dropped || minimized ? `（${[dropped, minimized].filter(Boolean).join("、")}）` : ""}`,
          );
        }
      } finally {
        session.dispose({ disposeSequence: false });
      }
    }
    throw lastError;
  }

  /** 输入 token 预算：上下文减去输出预留与缓冲。 */
  #availableInputTokens(maxTokens?: number): number {
    const ctxSize = this.#context?.contextSize ?? 8192;
    // 预留输出：取 maxTokens 与上下文 25% 的较小值，最少 128，避免生成把上下文挤爆。
    const reserve = Math.min(
      Math.max(128, Math.floor(ctxSize * 0.25)),
      maxTokens ?? Math.floor(ctxSize * 0.25),
    );
    return Math.max(256, ctxSize - reserve);
  }

  /** 用模型 tokenizer 量一段文本的 token 数；失败时退化为字符估算。 */
  #measureTextTokens(text: string): number {
    const model = this.#model;
    if (!model || !text) {
      return 0;
    }
    try {
      return model.tokenize(text).length;
    } catch {
      return Math.ceil(text.length / 3);
    }
  }

  /** 按 token 预算裁剪文本，保留头部与尾部，中间省略。 */
  #truncateTextByTokens(text: string, budgetTokens: number): string {
    const model = this.#model;
    if (!model) {
      return text;
    }
    let tokens: ReturnType<LlamaModel["tokenize"]>;
    try {
      tokens = model.tokenize(text);
    } catch {
      return text.slice(0, Math.max(0, budgetTokens * 3));
    }
    if (tokens.length <= budgetTokens) {
      return text;
    }
    const head = Math.floor(budgetTokens * 0.7);
    const tail = Math.max(0, budgetTokens - head);
    const kept = [...tokens.slice(0, head), ...tokens.slice(tokens.length - tail)];
    return model.detokenize(kept);
  }

  /**
   * 预裁剪：OpenNativeAI Agent 的 system prompt + 工具定义常超过小上下文本地模型的容量，
   * 而 node-llama-cpp 对 system 无法自动压缩会抛错（服务端表现为 500，CLI 伪装成 empty_model_response）。
   * 在字符串消息层（toChatHistory 之前）把超额的 system content 按 token 预算裁掉，
   * 始终保留最新 user 与非 system 内容，使请求落进上下文窗口正常生成。
   */
  private fitSystemMessagesToContext(
    messages: EngineChatMessage[],
    tools: EngineTool[],
    maxTokens?: number,
  ): void {
    const model = this.#model;
    if (!model) {
      return;
    }
    const systemMessages = messages.filter((m) => m.role === "system");
    if (systemMessages.length === 0) {
      return;
    }
    const available = this.#availableInputTokens(maxTokens);
    let nonSystemTokens = 0;
    for (const message of messages) {
      if (message.role === "system") {
        continue;
      }
      nonSystemTokens += this.#measureTextTokens(normalizeContent(message.content));
      if (message.tool_calls && message.tool_calls.length > 0) {
        nonSystemTokens += this.#measureTextTokens(JSON.stringify(message.tool_calls));
      }
    }
    if (tools.length > 0) {
      nonSystemTokens += this.#measureTextTokens(JSON.stringify(tools));
    }
    let systemTokens = 0;
    for (const message of systemMessages) {
      systemTokens += this.#measureTextTokens(normalizeContent(message.content));
    }
    if (nonSystemTokens + systemTokens <= available) {
      return;
    }
    let room = Math.max(0, available - nonSystemTokens);
    for (const message of systemMessages) {
      const text = normalizeContent(message.content);
      const tokens = this.#measureTextTokens(text);
      if (tokens <= room) {
        room -= tokens;
        continue;
      }
      if (room <= 0) {
        message.content = "[system prompt truncated: local context window too small]";
        continue;
      }
      message.content = `${this.#truncateTextByTokens(text, room)}\n[system prompt truncated to fit local context]`;
      room = 0;
    }
  }
}
