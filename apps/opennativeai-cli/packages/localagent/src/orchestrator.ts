/**
 * Agent 编排引擎（纯 TS 重写，对应 orchestrator.rs + events.rs）
 *
 * 协议与原 Rust 端严格一致，事件类型见 AgentEvent。
 * 主循环：streamChat -> 若有 tool_calls 则执行工具并把结果写回历史 -> 继续循环，
 * 直到模型不再发起工具调用（EndTurn）。每步通过 emit 推给前端的 onEvent。
 */
import { streamChat, type ChatMsg, type ModelConfig, type ChatOutcome } from "./llm.js";
import { executeTool, toolDefs, type ToolResult } from "./tools.js";
import { type LlmErrorCode, normalizeError } from "./errors.js";
import { validateToolCallArgs } from "./validate-tool-call.js";

export type AgentMode = "build" | "plan" | "ask";

export type SessionState =
  | "idle"
  | "running"
  | "awaiting_permission"
  | "done"
  | "cancelled"
  | "failed";

export type AgentEvent =
  | { kind: "session_started"; session_id: string; cwd: string }
  | { kind: "session_state_changed"; session_id: string; state: SessionState }
  | { kind: "task_started"; session_id: string; task_id: string; goal: string }
  | { kind: "turn_started"; session_id: string; task_id: string; turn: number }
  | { kind: "llm_token"; session_id: string; token: string }
  | { kind: "llm_thinking"; session_id: string; token: string }
  | {
      kind: "tool_call";
      session_id: string;
      task_id: string;
      call_id: string;
      name: string;
      args: unknown;
    }
  | {
      kind: "tool_result";
      session_id: string;
      task_id: string;
      call_id: string;
      ok: boolean;
      summary: string;
      ref_id: string | null;
      diff?: { added: number; removed: number } | null;
      diffText?: string | null;
    }
  | {
      kind: "turn_finished";
      session_id: string;
      task_id: string;
      turn: number;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
      elapsed_ms?: number | null;
    }
  | { kind: "task_finished"; session_id: string; task_id: string; ok: boolean; note: string | null }
  | {
      kind: "permission_request";
      session_id: string;
      call_id: string;
      capability: string;
      reason: string;
    }
  | {
      kind: "permission_resolved";
      session_id: string;
      call_id: string;
      granted: boolean;
    }
  | {
      kind: "error";
      session_id?: string | null;
      message: string;
      code: LlmErrorCode;
      retryable: boolean;
      technical?: string;
    };

interface Session {
  id: string;
  cwd: string;
  state: SessionState;
  history: ChatMsg[];
  cancel: { cancelled: boolean };
  model: ModelConfig | null;
  pendingPermission: Map<string, (allowed: boolean) => void>;
  nextId: number;
}

/**
 * 默认模型提供方：当调用方未携带 model 且 session 也未 setModel 时，
 * 由上层注册（例如从 provider registry 取当前激活的本地模型），避免调用方
 * 必须每次显式带上配置。
 */
let defaultModelProvider: (() => ModelConfig | null) | null = null;
export function setDefaultModelProvider(fn: () => ModelConfig | null): void {
  defaultModelProvider = fn;
}

const sessions = new Map<string, Session>();
let emit: (sessionId: string, ev: AgentEvent) => void = () => {};

export function setEmitter(fn: (sessionId: string, ev: AgentEvent) => void) {
  emit = fn;
}

const SYSTEM_PROMPT = `你是 Lite Agent（轻量级智能体，运行时标识 lite），一个集成在代码编辑器里的 AI 助手。
当用户询问你是什么智能体时，如实回答当前身份：Lite Agent（lite），与默认完整 CLI Agent（default）相区分。
你可以使用工具读取/修改文件、执行命令、检索符号。请尽量精准地完成任务。
回复用中文。

重要规则:
- 工具调用后必须用一段中文文字向用户说明结果或下一步计划,不允许以"工具调用"作为回复的结尾。
- 即便工具输出已包含完整信息,也要给用户一个简短的总结或引导。
- 反引号(\`)只用于真正的代码标识符(函数名/变量名/文件路径/命令/HTML 标签等)。
  普通描述性文字、HTML 属性的描述(例如 "html href=...")、CSS 关键字(例如 "@media")不要用反引号包裹,直接写出来。
- 启动本地服务(如 python -m http.server、vite、npm run dev 等需要长期运行的进程)必须用 run_server 工具,
  不要使用普通 bash —— 普通 bash 会在命令结束后杀掉进程,导致本地网页在后续对话中无法访问。
  启动后把返回 PID 与访问地址告诉用户;需要停止时再用 kill_server。`;

function newId(session: Session, prefix: string): string {
  return `${prefix}-${session.nextId++}`;
}

export function startSession(cwd: string): { session_id: string } {
  const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  sessions.set(id, {
    id,
    cwd,
    state: "idle",
    history: [],
    cancel: { cancelled: false },
    model: null,
    pendingPermission: new Map(),
    nextId: 1,
  });
  emit(id, { kind: "session_started", session_id: id, cwd });
  emit(id, { kind: "session_state_changed", session_id: id, state: "idle" });
  return { session_id: id };
}

export function setModel(sessionId: string, model: ModelConfig) {
  const s = sessions.get(sessionId);
  if (s) s.model = model;
}

export function cancelTurn(sessionId: string) {
  const s = sessions.get(sessionId);
  if (s) {
    s.cancel.cancelled = true;
    s.state = "cancelled";
    emit(sessionId, {
      kind: "session_state_changed",
      session_id: sessionId,
      state: "cancelled",
    });
  }
}

export function cancelSession(sessionId: string) {
  const s = sessions.get(sessionId);
  if (s) {
    s.cancel.cancelled = true;
    sessions.delete(sessionId);
    emit(sessionId, {
      kind: "session_state_changed",
      session_id: sessionId,
      state: "cancelled",
    });
  }
}

export function resolvePermission(sessionId: string, callId: string, allowed: boolean) {
  const s = sessions.get(sessionId);
  const resolver = s?.pendingPermission.get(callId);
  if (resolver) {
    s!.pendingPermission.delete(callId);
    resolver(allowed);
    emit(sessionId, {
      kind: "permission_resolved",
      session_id: sessionId,
      call_id: callId,
      granted: allowed,
    });
  }
}

// 权限请求：返回 Promise，等待上层 resolvePermission
function requestPermission(
  session: Session,
  _taskId: string,
  callId: string,
  tool: string,
  args: unknown,
): Promise<boolean> {
  return new Promise((resolve) => {
    session.pendingPermission.set(callId, resolve);
    emit(session.id, {
      kind: "permission_request",
      session_id: session.id,
      call_id: callId,
      capability: tool,
      reason: JSON.stringify(args ?? {}),
    });
    session.state = "awaiting_permission";
    emit(session.id, {
      kind: "session_state_changed",
      session_id: session.id,
      state: "awaiting_permission",
    });
  });
}

/**
 * 高危命令检测：普通命令默认直接执行（不询问），只有命中危险模式的才弹窗确认。
 * 覆盖：删除文件/目录、强制推送、清空磁盘、格式化、危险重定向、fork 炸弹等。
 */
function isDangerousCommand(cmd: string): boolean {
  const c = cmd.toLowerCase();
  const patterns: RegExp[] = [
    /\brm\s+(-[a-z]*r|-[a-z]*f|-rf|-fr|.*-[a-z]*rf)/, // rm -rf / rm -r / rm -f 等
    /\brmdir\b/, // 删目录
    /\bfind\s+[^-]*-delete/, // find -delete
    /\bgit\s+push\b[^]*-f\b/, // git push -f / --force
    /\bgit\s+reset\s+--hard\b/, // 丢弃本地改动
    /\bgit\s+clean\s+-[a-z]*[fd]/, // git clean -fd
    /\bgit\s+branch\s+-[a-z]*[Dd]/, // 强制删分支
    /\b(git\s+push.*--force|-f\b.*push)/, // 变体
    /\b(truncate|shred|dd\s+if=)\b/, // 破坏文件内容
    /\bmkfs\b/, // 格式化
    /:\s*\(\)\s*\{.*\|\s*:\s*&\s*\}/, // fork 炸弹
    /(>|>>)\s*\/dev\/sd[a-z]/, // 往裸盘写
    /\bsudo\b.*\brm\b/, // sudo rm
    /\bchmod\s+-R\s+0+\b/, // chmod -R 000
  ];
  return patterns.some((re) => re.test(c));
}

interface SendArgs {
  session_id: string;
  text: string;
  mode: AgentMode;
  model?: ModelConfig;
  model_config?: ModelConfig;
  system_prompt?: string;
}

export async function send(args: SendArgs): Promise<void> {
  const s = sessions.get(args.session_id);
  if (!s) throw new Error("unknown session");
  // 兼容两种字段名:model(优先) 或 model_config
  const incoming = args.model ?? args.model_config;
  if (incoming) s.model = incoming;
  // 兜底：调用方未携带且 session 未 setModel 时，尝试拿默认模型
  if (!s.model && defaultModelProvider) {
    s.model = defaultModelProvider();
  }
  if (!s.model) throw new Error("model 未设置");

  const taskId = newId(s, "task");
  const goal = args.text;
  const system = args.system_prompt ? String(args.system_prompt) : SYSTEM_PROMPT;

  s.cancel = { cancelled: false };
  s.state = "running";
  s.history.push({ role: "user", content: goal, tool_calls: [], tool_call_id: null });
  emit(s.id, { kind: "task_started", session_id: s.id, task_id: taskId, goal });
  emit(s.id, { kind: "session_state_changed", session_id: s.id, state: "running" });

  try {
    let turn = 0;
    // 主循环：最多 16 轮，避免无限工具循环
    while (turn < 16) {
      if (s.cancel.cancelled) return;
      emit(s.id, { kind: "turn_started", session_id: s.id, task_id: taskId, turn });

      const outcome: ChatOutcome = await streamChat(
        s.model,
        system,
        s.history,
        toolDefs(),
        s.cancel,
        (token) => emit(s.id, { kind: "llm_token", session_id: s.id, token }),
        (token) => emit(s.id, { kind: "llm_thinking", session_id: s.id, token }),
      );

      // 把 assistant 消息（含 tool_calls）写回历史
      s.history.push({
        role: "assistant",
        content: outcome.text,
        tool_calls: outcome.tool_calls,
        tool_call_id: null,
      });

      // 安全网:本地模型(Qwen/Llama 3 等)在工具调用后偶尔返回空 content + 无新 tool_calls,
      // 此时历史上一条是 tool 结果。注入一条 user nudge 重试一次,确保用户能看到文字总结。
      let actualOutcome = outcome;
      if (!outcome.text && outcome.tool_calls.length === 0) {
        const prev = s.history[s.history.length - 2]; // -2 因为刚 push 了 assistant
        if (prev && prev.role === "tool") {
          s.history.push({
            role: "user",
            content: "请用中文向用户总结刚才工具调用的结果。",
            tool_calls: [],
            tool_call_id: null,
          });
          actualOutcome = await streamChat(
            s.model,
            system,
            s.history,
            toolDefs(),
            s.cancel,
            (token) => emit(s.id, { kind: "llm_token", session_id: s.id, token }),
            (token) => emit(s.id, { kind: "llm_thinking", session_id: s.id, token }),
          );
          // 覆盖刚 push 的那条空 assistant,重写成真实响应
          s.history[s.history.length - 2] = {
            role: "assistant",
            content: actualOutcome.text,
            tool_calls: actualOutcome.tool_calls,
            tool_call_id: null,
          };
        }
      }

      if (actualOutcome.tool_calls.length === 0) {
        emit(s.id, {
          kind: "turn_finished",
          session_id: s.id,
          task_id: taskId,
          turn,
          usage: actualOutcome.usage,
          elapsed_ms: actualOutcome.elapsed_ms,
        });
        break;
      }

      // 执行每个工具调用
      for (const call of actualOutcome.tool_calls) {
        const callId = call.id || newId(s, "call");
        // 参数校验：小模型 (9B Q4) 常吐 tool_call with {}；空 cmd 会让 bash -c "" 静默无输出，
        // 模型下一轮就编造"沙箱吞输出"幻觉。先在入口检查 required 非空，失败则以 tool_result
        // 回注失败提示，让模型下一轮自己修正。修复依据：记忆 63ca63e4、0f7e626e。
        const invalidReason = validateToolCallArgs(call, toolDefs());
        if (invalidReason) {
          console.log("[agent] tool_call invalid:", call.name, invalidReason);
          emit(s.id, {
            kind: "tool_call",
            session_id: s.id,
            task_id: taskId,
            call_id: callId,
            name: call.name,
            args: call.args,
          });
          emit(s.id, {
            kind: "tool_result",
            session_id: s.id,
            task_id: taskId,
            call_id: callId,
            ok: false,
            summary: invalidReason,
            ref_id: null,
            diff: null,
            diffText: null,
          });
          s.history.push({
            role: "tool",
            content: invalidReason,
            tool_calls: [],
            tool_call_id: callId,
          });
          continue;
        }
        // 权限门：普通命令默认直接执行；仅命中高危模式的命令才请求确认
        let allowed = true;
        const cmd =
          call.name === "bash"
            ? String((call.args as { cmd?: unknown })?.cmd ?? "")
            : call.name === "run_tests"
              ? String((call.args as { cmd?: unknown })?.cmd ?? "npm test")
              : call.name === "run_server"
                ? String((call.args as { cmd?: unknown })?.cmd ?? "")
                : call.name === "kill_server"
                  ? `kill ${Number((call.args as { pid?: unknown })?.pid ?? 0)}`
                  : "";
        if (cmd && isDangerousCommand(cmd)) {
          allowed = await requestPermission(s, taskId, callId, call.name, call.args);
          if (s.cancel.cancelled) return;
        }
        emit(s.id, {
          kind: "tool_call",
          session_id: s.id,
          task_id: taskId,
          call_id: callId,
          name: call.name,
          args: call.args,
        });
        const result: ToolResult = allowed
          ? await executeTool(call, { cwd: s.cwd, sessionId: s.id })
          : { ok: false, summary: "权限被拒绝", ref_id: null };
        emit(s.id, {
          kind: "tool_result",
          session_id: s.id,
          task_id: taskId,
          call_id: callId,
          ok: result.ok,
          summary: result.summary,
          ref_id: result.ref_id ?? null,
          diff: result.diff ?? null,
          diffText: result.diffText ?? null,
        });
        s.history.push({
          role: "tool",
          content: result.summary,
          tool_calls: [],
          tool_call_id: callId,
        });
      }

      emit(s.id, {
        kind: "turn_finished",
        session_id: s.id,
        task_id: taskId,
        turn,
        usage: outcome.usage,
        elapsed_ms: outcome.elapsed_ms,
      });
      turn++;
    }

    s.state = "done";
    emit(s.id, { kind: "task_finished", session_id: s.id, task_id: taskId, ok: true, note: null });
    emit(s.id, { kind: "session_state_changed", session_id: s.id, state: "done" });
  } catch (err) {
    s.state = "failed";
    const info = normalizeError(err);
    // 用户取消不当作错误发,只是静默收尾
    if (info.code === "cancelled") {
      emit(s.id, {
        kind: "task_finished",
        session_id: s.id,
        task_id: taskId,
        ok: false,
        note: null,
      });
      emit(s.id, {
        kind: "session_state_changed",
        session_id: s.id,
        state: "cancelled",
      });
      return;
    }
    // 先发结构化 error 事件(上层可据此显示重试按钮等),再发 task_finished + state 变化
    emit(s.id, {
      kind: "error",
      session_id: s.id,
      message: info.user,
      code: info.code,
      retryable: info.retryable,
      technical: info.technical,
    });
    emit(s.id, {
      kind: "task_finished",
      session_id: s.id,
      task_id: taskId,
      ok: false,
      note: info.user,
    });
    emit(s.id, { kind: "session_state_changed", session_id: s.id, state: "failed" });
  }
}
