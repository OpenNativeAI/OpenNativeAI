import { useMemo, useState } from "react";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";

// ---------------------------------------------------------------------------
// 应用运行日志：把 `[日期 时间] [级别] [pid] [scope] 消息` 解析成结构化、可过滤的行。
// ---------------------------------------------------------------------------
type LogLevel = "info" | "warn" | "error" | "debug" | "other";

interface ParsedLogLine {
  time: string;
  level: LogLevel;
  levelText: string;
  scope: string;
  message: string;
  raw: string;
}

const LOG_LINE_RE =
  /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})\]\s+\[([a-zA-Z]+)\]\s+\[pid:\d+\]\s+\[([^\]]+)\]\s*([\s\S]*)$/;

function normalizeLevel(level: string): LogLevel {
  const l = level.toLowerCase();
  if (l === "info" || l === "warn" || l === "error" || l === "debug") return l;
  return "other";
}

function parseLogLine(line: string): ParsedLogLine {
  const match = line.match(LOG_LINE_RE);
  if (!match) {
    return { time: "", level: "other", levelText: "", scope: "", message: line, raw: line };
  }
  const [, , time, level, scope, message] = match;
  const safeLevel = level ?? "";
  return {
    time: time ?? "",
    level: normalizeLevel(safeLevel),
    levelText: safeLevel.toLowerCase(),
    scope: scope ?? "",
    message: message ?? "",
    raw: line,
  };
}

const LEVEL_PILL_CLASS: Record<LogLevel, string> = {
  info: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  error: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  debug: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  other: "bg-transparent text-transparent",
};

const LEVEL_ROW_CLASS: Record<LogLevel, string> = {
  info: "",
  warn: "bg-amber-50/60 dark:bg-amber-950/20",
  error: "bg-red-50/60 dark:bg-red-950/20",
  debug: "",
  other: "",
};

type LevelFilter = "all" | LogLevel;

export function AppLogView({ raw }: { raw: string }) {
  const { intl } = useOpenNativeAIIntl();
  const [filter, setFilter] = useState<LevelFilter>("all");

  const parsed = useMemo(() => raw.split("\n").map(parseLogLine), [raw]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { info: 0, warn: 0, error: 0, debug: 0 };
    for (const line of parsed) {
      if (line.level in c) c[line.level] = (c[line.level] ?? 0) + 1;
    }
    return c;
  }, [parsed]);

  const visible = useMemo(
    () => (filter === "all" ? parsed : parsed.filter((l) => l.level === filter)),
    [parsed, filter],
  );

  const filterOptions: Array<{ id: LevelFilter; label: string }> = [
    { id: "all", label: intl.formatMessage({ id: "settings.logs.level.all" }) },
    {
      id: "info",
      label: `${intl.formatMessage({ id: "settings.logs.level.info" })} (${counts.info ?? 0})`,
    },
    {
      id: "warn",
      label: `${intl.formatMessage({ id: "settings.logs.level.warn" })} (${counts.warn ?? 0})`,
    },
    {
      id: "error",
      label: `${intl.formatMessage({ id: "settings.logs.level.error" })} (${counts.error ?? 0})`,
    },
    {
      id: "debug",
      label: `${intl.formatMessage({ id: "settings.logs.level.debug" })} (${counts.debug ?? 0})`,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
        {filterOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={
              filter === option.id
                ? "rounded-md bg-accent px-2 py-0.5 text-ui-xs font-medium text-foreground"
                : "rounded-md px-2 py-0.5 text-ui-xs text-foreground-subtle hover:bg-surface-hover"
            }
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto font-mono text-ui-xs leading-relaxed">
        {visible.map((line, index) => (
          <div
            key={index}
            className={`flex items-start gap-2 border-b border-border/40 px-3 py-1 ${LEVEL_ROW_CLASS[line.level]}`}
          >
            <span
              className={`mt-px inline-flex w-12 shrink-0 justify-center rounded px-1 text-[10px] font-semibold uppercase ${LEVEL_PILL_CLASS[line.level]}`}
            >
              {line.levelText}
            </span>
            {line.time ? (
              <span className="shrink-0 text-foreground-subtle">{line.time}</span>
            ) : null}
            {line.scope ? (
              <span className="shrink-0 rounded bg-surface-hover px-1 text-foreground-subtle">
                {line.scope}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 break-words whitespace-pre-wrap text-foreground">
              {line.message}
            </span>
          </div>
        ))}
        {visible.length === 0 ? (
          <div className="p-6 text-center text-foreground-subtle">
            {intl.formatMessage({ id: "settings.logs.empty" })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
