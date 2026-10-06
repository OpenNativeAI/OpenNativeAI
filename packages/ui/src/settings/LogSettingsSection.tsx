import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, FolderOpen, FileText, ChevronDown, ChevronRight, Folder } from "lucide-react";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { Button } from "@/components/ui/button.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";
import { AppLogView } from "@/settings/AppLogView.js";
import { AgentLogView } from "@/settings/AgentLogView.js";
import { logger } from "@/logger.js";

type LogCategory = "app" | "agent";

interface LogFileEntry {
  name: string;
  sizeBytes: number;
  modifiedAt: number;
  category: LogCategory;
  subdir?: string;
  dir: string;
  sessionName?: string;
}

// 同一 basename 可能出现在多个来源目录，用分类+子目录+会话+名称组合键唯一标识选中项。
function entryKey(entry: LogFileEntry): string {
  return `${entry.category}:${entry.subdir ?? ""}:${entry.sessionName ?? ""}:${entry.name}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModifiedTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 从会话文件夹名提取显示时间，如 "2026-10-01T20-39_sess_xxx" → "2026-10-01 20:39" */
function sessionDisplayName(sessionName: string): string {
  const tsPart = sessionName.split("_")[0] ?? sessionName;
  // tsPart 格式：YYYY-MM-DDTHH-mm
  const match = tsPart.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/);
  if (match) return `${match[1]} ${match[2]}:${match[3]}`;
  return sessionName;
}

/** 从 turn 文件名提取轮次编号，如 "turn-3.jsonl" → 3 */
function turnNumber(fileName: string): number {
  const m = fileName.match(/turn-(\d+)/);
  return m ? Number(m[1]) : 0;
}

/**
 * 单一分类的日志浏览器。应用日志与 Agent 轨迹分属不同设置分区，各自固定一个 category，
 * 不再在同一分区内用 tab 混排，避免用户误删一个目录却看不到另一个的变化。
 */
function LogFileBrowser({ category }: { category: LogCategory }) {
  const { intl } = useOpenNativeAIIntl();
  const platform = usePlatform();
  const [files, setFiles] = useState<LogFileEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  // Agent 日志树形视图：展开的会话集合
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  const refreshFiles = useCallback(async (): Promise<LogFileEntry[]> => {
    if (!platform.listLogFiles) return [];
    setLoading(true);
    try {
      const list = await platform.listLogFiles();
      // 只保留当前分区的分类，应用日志与 Agent 轨迹互不混入。
      const filtered = list.filter((f) => f.category === category);
      setFiles(filtered);
      return filtered;
    } catch (error) {
      logger.warn("[log-settings] failed to list log files", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    } finally {
      setLoading(false);
    }
  }, [platform, category]);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  // 读取指定文件内容到右侧。单独抽出，供「选中」与「刷新」复用。
  const loadFileContent = useCallback(
    async (entry: LogFileEntry) => {
      if (!platform.readLogFileContent) return;
      setReading(true);
      try {
        const result = await platform.readLogFileContent(
          entry.name,
          entry.category,
          entry.subdir,
          entry.sessionName,
        );
        if (result) {
          setRawContent(result.content);
          setTruncated(result.truncated);
        }
      } catch (error) {
        logger.warn("[log-settings] failed to read log file", {
          error: error instanceof Error ? error.message : String(error),
          fileName: entry.name,
        });
      } finally {
        setReading(false);
      }
    },
    [platform],
  );

  const handleSelectFile = useCallback(
    async (entry: LogFileEntry) => {
      setSelectedKey(entryKey(entry));
      setRawContent(null);
      setTruncated(false);
      await loadFileContent(entry);
    },
    [loadFileContent],
  );

  // 刷新：既重扫目录，也重新读取当前选中文件，拿到磁盘上的最新内容。
  // （之前只重扫列表，会话还在写日志时右侧会一直停在旧快照，用户感觉「刷新没用」。）
  const handleRefresh = useCallback(async () => {
    const list = await refreshFiles();
    if (!selectedKey) return;
    const entry = list.find((f) => entryKey(f) === selectedKey);
    if (entry) await loadFileContent(entry);
  }, [refreshFiles, selectedKey, loadFileContent]);

  const selectedEntry = files.find((f) => entryKey(f) === selectedKey) ?? null;

  // 来源目录去重展示，让用户一眼看清这个分区读的是哪个物理文件夹。
  const sourceDirs = useMemo(() => {
    const set = new Set<string>();
    for (const f of files) set.add(f.dir);
    return [...set];
  }, [files]);

  // Agent 日志按 sessionName 分组，用于树形展示。
  const sessionGroups = useMemo(() => {
    if (category !== "agent") return null;
    const map = new Map<string, LogFileEntry[]>();
    for (const f of files) {
      const key = f.sessionName ?? "_legacy";
      const arr = map.get(key);
      if (arr) arr.push(f);
      else map.set(key, [f]);
    }
    // 按会话名降序（时间戳新的在前），组内按 turn 编号升序
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([name, turns]) => ({
        name,
        turns: turns.sort((a, b) => turnNumber(a.name) - turnNumber(b.name)),
      }));
  }, [files, category]);

  const subtitleId =
    category === "app" ? "settings.logs.subtitle" : "settings.agentTrajectory.subtitle";

  const platformAvailable = Boolean(platform.listLogFiles && platform.readLogFileContent);

  return (
    <div className="space-y-4">
      {!platformAvailable ? (
        <SettingsGroupCard>
          <div className="px-4 py-3 text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.logs.desktopOnly" })}
          </div>
        </SettingsGroupCard>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-2">
          <div className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: subtitleId })}
          </div>
          <div className="flex min-h-0 flex-1 gap-4">
            {/* 左侧文件列表 */}
            <div className="flex w-72 shrink-0 flex-col rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-ui-sm font-medium text-foreground">
                  {intl.formatMessage({ id: "settings.logs.files" })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRefresh()}
                  disabled={loading}
                  aria-label={intl.formatMessage({ id: "settings.logs.refresh" })}
                >
                  <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-1.5">
                {files.length === 0 && !loading ? (
                  <div className="px-3 py-6 text-center text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({ id: "settings.logs.empty" })}
                  </div>
                ) : sessionGroups ? (
                  /* Agent 日志：树形视图，按会话分组 */
                  sessionGroups.map((group) => {
                    const isExpanded = expandedSessions.has(group.name);
                    return (
                      <div key={group.name} className="mb-0.5">
                        <button
                          type="button"
                          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
                          onClick={() =>
                            setExpandedSessions((prev) => {
                              const next = new Set(prev);
                              if (next.has(group.name)) next.delete(group.name);
                              else next.add(group.name);
                              return next;
                            })
                          }
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-3 shrink-0 text-foreground-subtle" />
                          ) : (
                            <ChevronRight className="size-3 shrink-0 text-foreground-subtle" />
                          )}
                          <Folder className="size-3.5 shrink-0 text-foreground-subtle" />
                          <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-foreground">
                            {group.name === "_legacy"
                              ? intl.formatMessage({ id: "settings.logs.legacy" })
                              : sessionDisplayName(group.name)}
                          </span>
                          <span className="shrink-0 text-ui-xs text-foreground-subtle">
                            {group.turns.length}
                          </span>
                        </button>
                        {isExpanded ? (
                          <div className="ml-4 border-l border-border pl-1.5">
                            {group.turns.map((file) => (
                              <button
                                key={entryKey(file)}
                                type="button"
                                className={
                                  selectedKey === entryKey(file)
                                    ? "flex w-full items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-left"
                                    : "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-surface-hover"
                                }
                                onClick={() => void handleSelectFile(file)}
                              >
                                <FileText className="size-3 shrink-0 text-foreground-subtle" />
                                <span className="min-w-0 flex-1 truncate text-ui-xs text-foreground">
                                  {intl.formatMessage({ id: "settings.logs.turn" })} #
                                  {turnNumber(file.name)}
                                </span>
                                <span className="shrink-0 text-[10px] text-foreground-subtle">
                                  {formatFileSize(file.sizeBytes)}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  /* 应用日志：扁平列表 */
                  files.map((file) => (
                    <button
                      key={entryKey(file)}
                      type="button"
                      className={
                        selectedKey === entryKey(file)
                          ? "flex w-full items-start gap-2 rounded-md bg-accent px-2.5 py-2 text-left"
                          : "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-surface-hover"
                      }
                      onClick={() => void handleSelectFile(file)}
                    >
                      <FileText className="mt-0.5 size-3.5 shrink-0 text-foreground-subtle" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-ui-sm font-medium text-foreground">
                          {file.name}
                        </div>
                        <div className="text-ui-xs text-foreground-subtle">
                          {formatModifiedTime(file.modifiedAt)} · {formatFileSize(file.sizeBytes)}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
              {sourceDirs.length > 0 ? (
                <div className="border-t border-border px-3 py-2">
                  <div className="mb-0.5 text-ui-xs font-medium text-foreground-subtle">
                    {intl.formatMessage({ id: "settings.logs.sourceFolder" })}
                  </div>
                  {sourceDirs.map((dir) => (
                    <div
                      key={dir}
                      className="truncate font-mono text-ui-xs text-foreground-subtle"
                      title={dir}
                    >
                      {dir}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {/* 右侧内容区 */}
            <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-card">
              <div className="border-b border-border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-ui-sm font-medium text-foreground">
                    {selectedEntry?.name ?? intl.formatMessage({ id: "settings.logs.selectHint" })}
                  </span>
                  {truncated ? (
                    <span className="ml-2 shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-ui-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      {intl.formatMessage({ id: "settings.logs.truncated" })}
                    </span>
                  ) : null}
                </div>
                {/* 选中文件时显示完整路径（不截断、自动换行）；点击在系统文件管理器中定位该文件。 */}
                {selectedEntry ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (platform.revealLogFile) {
                        void platform.revealLogFile(
                          selectedEntry.name,
                          category,
                          selectedEntry.subdir,
                          selectedEntry.sessionName,
                        );
                      }
                    }}
                    className="mt-1 flex max-w-full items-start gap-1.5 text-left transition-colors hover:text-foreground"
                    title={intl.formatMessage({ id: "settings.logs.revealHint" })}
                  >
                    <FolderOpen className="mt-0.5 size-3 shrink-0 text-foreground-subtle" />
                    <span className="min-w-0 break-all font-mono text-ui-xs leading-relaxed text-foreground-subtle">
                      {`${selectedEntry.dir}/${selectedEntry.name}`}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-ui-xs text-foreground-subtle underline decoration-dotted">
                      {intl.formatMessage({ id: "settings.logs.revealAction" })}
                    </span>
                  </button>
                ) : null}
              </div>
              <div className="min-h-0 flex-1">
                {reading ? (
                  <div className="flex h-full items-center justify-center text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({ id: "settings.logs.loading" })}
                  </div>
                ) : rawContent != null ? (
                  category === "app" ? (
                    <AppLogView raw={rawContent} />
                  ) : (
                    <AgentLogView raw={rawContent} />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({ id: "settings.logs.selectFile" })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 底部：导出日志按钮 */}
      {platformAvailable ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void platform.exportLogs()}
          >
            <FolderOpen className="mr-1.5 size-3.5" />
            {intl.formatMessage({ id: "settings.logs.export" })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 「日志」分区：顶部在「应用日志」与「Agent 日志」之间切换。
 * 两者仍读不同物理目录（v2/logs 与 cli/debug·rollout），切换时靠下方「来源目录」区分，
 * 避免早期「删了一个目录却看到另一个还在」的困惑。
 */
export function LogSettingsSection() {
  const { intl } = useOpenNativeAIIntl();
  // 修复：默认应展示 Agent 日志（model-io），而非应用日志
  const [category, setCategory] = useState<LogCategory>("agent");
  const tabs: Array<{ id: LogCategory; label: string }> = [
    { id: "agent", label: intl.formatMessage({ id: "settings.logs.tab.agent" }) },
    { id: "app", label: intl.formatMessage({ id: "settings.logs.tab.app" }) },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="inline-flex shrink-0 self-start rounded-lg border border-border bg-card p-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setCategory(tab.id)}
            className={
              category === tab.id
                ? "rounded-md bg-accent px-3 py-1 text-ui-sm font-medium text-foreground"
                : "rounded-md px-3 py-1 text-ui-sm text-foreground-subtle hover:bg-surface-hover"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* key={category}：切换分类时重挂载浏览器，清空上一分类的选中文件与内容。 */}
      <LogFileBrowser key={category} category={category} />
    </div>
  );
}
