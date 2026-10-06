import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";

// ---------------------------------------------------------------------------
// 工具定义面板：展示「发给模型的工具调用格式」。
//
// model-io 的 request.body.tools 是每次请求随消息一起发给模型的工具 schema 数组
// （OpenAI function-calling 格式：{ type:"function", function:{ name, description,
// parameters } }）。模型正是靠这份定义才知道「有哪些工具、每个工具怎么调用」。
// 时间线只还原了 messages，若不单独列出 tools，就等于漏掉了发给 AI 的一大块内容，
// 所以这里把它补上，可折叠、逐个工具展开看 description + 参数 Schema。
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolCard({ tool }: { tool: ToolDefinition }) {
  const { intl } = useOpenNativeAIIntl();
  const [open, setOpen] = useState(false);
  const fn = tool.function ?? {};
  const name = fn.name ?? "tool";
  const desc = fn.description ?? "";
  const firstLine = desc.split("\n")[0] ?? "";
  return (
    <div className="border-b border-border/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 pl-6 text-left hover:bg-surface-hover"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0 text-foreground-subtle" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-foreground-subtle" />
        )}
        <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
          {name}
        </span>
        {!open && firstLine ? (
          <span className="min-w-0 flex-1 truncate text-ui-xs text-foreground-subtle">
            {firstLine}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="space-y-2 py-1 pl-10">
          {desc ? (
            <pre className="max-h-[30vh] overflow-auto rounded bg-surface-hover/30 p-2 font-mono text-ui-xs leading-relaxed break-words whitespace-pre-wrap text-foreground-subtle">
              {desc}
            </pre>
          ) : null}
          {fn.parameters ? (
            <div className="space-y-1">
              <span className="text-ui-xs font-medium text-foreground-subtle">
                {intl.formatMessage({ id: "settings.logs.tools.parameters" })}
              </span>
              <pre className="max-h-[35vh] overflow-auto rounded bg-surface-hover/40 p-2 font-mono text-ui-xs leading-relaxed break-words whitespace-pre-wrap text-foreground">
                {prettyJson(fn.parameters)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ToolList({ tools }: { tools: ToolDefinition[] }) {
  if (tools.length === 0) return null;
  return (
    <div>
      {tools.map((t, i) => (
        <ToolCard key={i} tool={t} />
      ))}
    </div>
  );
}
