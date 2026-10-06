import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";
import type { ToolDefinition } from "@/settings/AgentToolsPanel.js";

// ---------------------------------------------------------------------------
// Agent 轨迹查看器的底层渲染件与数据类型（供 AgentLogView 复用）。
// 拆出来是为了让主文件专注「轮次」结构，同时满足单文件行数上限。
// ---------------------------------------------------------------------------

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export interface SdkContentPart {
  type?: string;
  text?: string;
}

export interface SdkToolCall {
  id?: string;
  name?: string;
  input?: unknown;
}

export interface SdkMessage {
  role?: string;
  content?: string | SdkContentPart[];
  toolCalls?: SdkToolCall[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

// 真正发给模型的 HTTP 请求体：字段顺序即发送顺序，tools 与 messages 平级。
export interface RequestBody {
  model?: string;
  messages?: unknown[];
  tools?: ToolDefinition[];
  [key: string]: unknown;
}

export interface ModelIoRecord {
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: unknown;
  type?: string;
  model?: { modelId?: string; providerId?: string };
  /** 本地引擎实际保留的工具名（经 filterLocalBasicTools 过滤后由响应头回传）。 */
  localEngineFilteredToolNames?: string[];
  request?: {
    messages?: SdkMessage[];
    body?: RequestBody;
  };
  response?: {
    text?: string;
    toolCalls?: SdkToolCall[];
    usage?: Record<string, unknown>;
  };
}

const ROLE_BADGE_CLASS: Record<string, string> = {
  system: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  user: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  assistant: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  tool: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

function roleBadgeClass(role: string): string {
  return (
    ROLE_BADGE_CLASS[role.toLowerCase()] ??
    "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
  );
}

export function ContentBlock({
  text,
  tone = "default",
}: {
  text: string;
  tone?: "default" | "muted";
}) {
  return (
    <pre
      className={`max-h-[45vh] overflow-auto rounded p-2 font-mono text-ui-xs leading-relaxed break-words whitespace-pre-wrap ${
        tone === "muted"
          ? "bg-surface-hover/30 text-foreground-subtle"
          : "bg-surface-hover/40 text-foreground"
      }`}
    >
      {text}
    </pre>
  );
}

export function ToolCallBlock({ call }: { call: SdkToolCall }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="inline-flex shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
          {call.name ?? "tool"}
        </span>
        {call.id ? (
          <span className="truncate font-mono text-[10px] text-foreground-subtle">{call.id}</span>
        ) : null}
      </div>
      {call.input !== undefined ? <ContentBlock text={prettyJson(call.input)} /> : null}
    </div>
  );
}

function TurnBody({ message }: { message: SdkMessage }) {
  const { content } = message;
  const blocks: ReactNode[] = [];
  if (typeof content === "string") {
    if (content) blocks.push(<ContentBlock key="c" text={content} />);
  } else if (Array.isArray(content)) {
    content.forEach((part, i) => {
      if (part && typeof part.text === "string") {
        blocks.push(
          <ContentBlock
            key={i}
            text={part.text}
            tone={part.type === "reasoning" ? "muted" : "default"}
          />,
        );
      } else {
        blocks.push(<ContentBlock key={i} text={prettyJson(part)} tone="muted" />);
      }
    });
  } else if (content != null) {
    blocks.push(<ContentBlock key="c" text={prettyJson(content)} />);
  }
  for (const [i, call] of (message.toolCalls ?? []).entries()) {
    blocks.push(<ToolCallBlock key={`tc-${i}`} call={call} />);
  }
  return <div className="space-y-1">{blocks}</div>;
}

export function Turn({ message, seq }: { message: SdkMessage; seq: number }) {
  const role = message.role ?? "unknown";
  return (
    <div className="border-b border-border/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="shrink-0 font-mono text-ui-xs font-medium text-foreground-subtle">
          {seq}
        </span>
        <span
          className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${roleBadgeClass(role)}`}
        >
          {role}
        </span>
        {message.toolName ? (
          <span className="truncate text-ui-xs text-foreground-subtle">{message.toolName}</span>
        ) : null}
        {message.isError ? (
          <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-900/40 dark:text-red-300">
            error
          </span>
        ) : null}
      </div>
      <TurnBody message={message} />
    </div>
  );
}

// 可折叠小节：用于「系统提示词 / 对话消息 / 工具定义」这类大块内容。
export function Section({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded border border-border/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-surface-hover"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0 text-foreground-subtle" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-foreground-subtle" />
        )}
        <span className="text-ui-xs font-medium text-foreground">{title}</span>
        {count != null ? (
          <span className="rounded bg-surface-hover px-1.5 text-[10px] text-foreground-subtle">
            {count}
          </span>
        ) : null}
      </button>
      {open ? <div className="border-t border-border/40">{children}</div> : null}
    </div>
  );
}

// 请求参数行：把 body 里除 messages / tools 外的标量字段（model、tool_choice…）如实列出。
export function ParamsRow({ body }: { body?: RequestBody }) {
  const { intl } = useOpenNativeAIIntl();
  if (!body) return null;
  const entries = Object.entries(body).filter(([k]) => k !== "messages" && k !== "tools");
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border/50 px-2 py-1.5">
      <span className="text-ui-xs font-medium text-foreground">
        {intl.formatMessage({ id: "settings.logs.round.params" })}
      </span>
      {entries.map(([k, v]) => (
        <span key={k} className="font-mono text-ui-xs text-foreground-subtle">
          {k}=
          <span className="text-foreground">
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </span>
        </span>
      ))}
    </div>
  );
}
