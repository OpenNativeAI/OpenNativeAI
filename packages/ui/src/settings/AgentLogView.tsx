import { useMemo, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";
import { ToolList } from "@/settings/AgentToolsPanel.js";
import {
  prettyJson,
  ContentBlock,
  ToolCallBlock,
  Turn,
  Section,
  ParamsRow,
  type SdkMessage,
  type ModelIoRecord,
} from "@/settings/AgentLogTurns.js";

// ---------------------------------------------------------------------------
// Agent 轨迹：按「轮次」忠实还原 Agent 循环。
//
// model-io 每行 JSONL = 一次模型调用 = Agent 的一轮。每一轮：
//   → 发给 AI：request.messages（系统提示词 + 到本轮为止的全部对话）
//              + request.body.tools（工具定义）+ 其它请求参数
//   ← AI 回复：response.text / response.toolCalls（+ usage / error）
// 模型无状态，所以每轮都会把完整历史重发一遍——这里就按每轮如实体现在一张卡里，
// 不再把所有轮次揉成一条时间线，避免看不清「这一轮到底发了什么、回了什么」。
// ---------------------------------------------------------------------------

function parseRecords(raw: string): ModelIoRecord[] {
  const out: ModelIoRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ModelIoRecord);
    } catch {
      // 单行解析失败（如 2MB 截断的尾行）忽略，不影响其余记录。
    }
  }
  const ts = (r: ModelIoRecord) => Date.parse(r.startedAt ?? r.completedAt ?? "") || 0;
  // 按时间升序 = Agent 真实轮次顺序。
  return out.sort((a, b) => ts(a) - ts(b));
}

function RoundCard({ record, index }: { record: ModelIoRecord; index: number }) {
  const { intl } = useOpenNativeAIIntl();
  const [open, setOpen] = useState(true);
  const messages = record.request?.messages ?? [];
  const allTools = record.request?.body?.tools ?? [];
  // 本地引擎经 filterLocalBasicTools 过滤后，模型实际只看到白名单工具。
  // CLI 落盘的 request.body.tools 仍是全量，这里按响应头回传的实际名单筛选展示。
  const filteredNames = record.localEngineFilteredToolNames;
  const tools = filteredNames
    ? allTools.filter((t) => filteredNames.includes(t.function?.name ?? ""))
    : allTools;
  const isSystem = (m: SdkMessage) => (m.role ?? "").toLowerCase() === "system";
  const systemMsgs = messages.filter(isSystem);
  const convoMsgs = messages.filter((m) => !isSystem(m));
  const resp = record.response;
  const respToolCalls = resp && Array.isArray(resp.toolCalls) ? resp.toolCalls : [];
  const hasError = record.error != null && record.error !== false;
  const head = [
    record.startedAt,
    record.model?.modelId,
    record.durationMs != null ? `${record.durationMs}ms` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const reply = resp?.text?.trim()
    ? resp.text.trim().slice(0, 80)
    : respToolCalls.length > 0
      ? `${intl.formatMessage({ id: "settings.logs.round.callTool" })} ${respToolCalls
          .map((c) => c.name ?? "?")
          .join("、")}`
      : hasError
        ? intl.formatMessage({ id: "settings.logs.round.errorReply" })
        : intl.formatMessage({ id: "settings.logs.round.emptyReply" });

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-foreground-subtle" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-foreground-subtle" />
        )}
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
          #{index + 1}
        </span>
        <span className="shrink-0 font-mono text-ui-xs text-foreground-subtle">{head}</span>
        <span className="min-w-0 flex-1 truncate text-ui-xs text-foreground">← {reply}</span>
        <span className="shrink-0 text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "settings.logs.round.msgs" })} {messages.length} ·{" "}
          {intl.formatMessage({ id: "settings.logs.round.tools" })} {tools.length}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 px-3 pb-3">
          {/* → 发给 AI：这一轮完整请求 */}
          <div className="rounded-md border border-border">
            <div className="border-b border-border bg-surface-hover/30 px-2.5 py-1.5 text-ui-xs font-semibold text-foreground">
              {intl.formatMessage({ id: "settings.logs.round.sent" })}
            </div>
            <div className="space-y-2 p-2.5">
              <Section
                title={intl.formatMessage({ id: "settings.logs.round.system" })}
                count={systemMsgs.length}
              >
                {systemMsgs.map((m, i) => (
                  <Turn key={i} message={m} seq={i + 1} />
                ))}
              </Section>
              <Section
                title={intl.formatMessage({ id: "settings.logs.round.convo" })}
                count={convoMsgs.length}
                defaultOpen
              >
                {convoMsgs.map((m, i) => (
                  <Turn key={i} message={m} seq={i + 1} />
                ))}
              </Section>
              <Section
                title={intl.formatMessage({ id: "settings.logs.round.tools" })}
                count={tools.length}
              >
                {filteredNames ? (
                  <div className="mx-2 mt-2 rounded bg-amber-50 px-2 py-1 text-ui-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                    {intl.formatMessage(
                      { id: "settings.logs.round.localFiltered" },
                      { count: filteredNames.length, total: allTools.length },
                    )}
                  </div>
                ) : null}
                <ToolList tools={tools} />
              </Section>
              <ParamsRow body={record.request?.body} />
            </div>
          </div>
          {/* ← AI 回复：这一轮模型返回 */}
          <div className="rounded-md border border-border">
            <div className="border-b border-border bg-surface-hover/30 px-2.5 py-1.5 text-ui-xs font-semibold text-foreground">
              {intl.formatMessage({ id: "settings.logs.round.reply" })}
            </div>
            <div className="space-y-2 p-2.5">
              {hasError ? <ContentBlock text={prettyJson(record.error)} tone="muted" /> : null}
              {resp?.text ? <ContentBlock text={resp.text} /> : null}
              {respToolCalls.map((c, i) => (
                <ToolCallBlock key={i} call={c} />
              ))}
              {resp?.usage ? (
                <div className="font-mono text-ui-xs text-foreground-subtle">
                  {prettyJson(resp.usage)}
                </div>
              ) : null}
              {!resp?.text && respToolCalls.length === 0 && !hasError ? (
                <div className="text-ui-xs text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.logs.round.emptyReply" })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RawRecords({ records }: { records: ModelIoRecord[] }) {
  const [openSet, setOpenSet] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <div>
      {records.map((r, i) => {
        const open = openSet.has(i);
        return (
          <div key={i} className="border-b border-border/40">
            <button
              type="button"
              onClick={() => toggle(i)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover"
            >
              <span className="shrink-0 text-ui-xs font-medium text-foreground-subtle">
                #{i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">
                {[r.startedAt, r.model?.modelId, r.durationMs != null ? `${r.durationMs}ms` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
            {open ? (
              <pre className="max-h-[60vh] overflow-auto bg-surface-hover/30 p-3 font-mono text-ui-xs leading-relaxed break-words whitespace-pre-wrap text-foreground">
                {prettyJson(r)}
              </pre>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

type ViewMode = "rounds" | "raw";

/** 从记录序列提取对话概览：首条 user 文本 + 模型标识，让用户一眼看清「这是哪个对话」。 */
function useConversationSummary(records: ModelIoRecord[]) {
  return useMemo(() => {
    const modelId = records.find((r) => r.model?.modelId)?.model?.modelId;
    for (const r of records) {
      const msgs = r.request?.messages ?? [];
      const userMsg = msgs.find((m) => (m.role ?? "").toLowerCase() === "user");
      if (!userMsg) continue;
      const text =
        typeof userMsg.content === "string"
          ? userMsg.content
          : Array.isArray(userMsg.content)
            ? userMsg.content
                .filter((p) => p.type === "text" && p.text)
                .map((p) => p.text)
                .join(" ")
            : "";
      if (text.trim()) {
        return { preview: text.trim().slice(0, 120), modelId };
      }
    }
    return { preview: null as string | null, modelId };
  }, [records]);
}

export function AgentLogView({ raw }: { raw: string }) {
  const { intl } = useOpenNativeAIIntl();
  const [mode, setMode] = useState<ViewMode>("rounds");
  const records = useMemo(() => parseRecords(raw), [raw]);
  const summary = useConversationSummary(records);

  const tabs: Array<{ id: ViewMode; label: string }> = [
    { id: "rounds", label: intl.formatMessage({ id: "settings.logs.view.rounds" }) },
    { id: "raw", label: intl.formatMessage({ id: "settings.logs.view.raw" }) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id)}
              className={
                mode === tab.id
                  ? "rounded bg-accent px-2 py-0.5 text-ui-xs font-medium text-foreground"
                  : "rounded px-2 py-0.5 text-ui-xs text-foreground-subtle hover:bg-surface-hover"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
        {mode === "rounds" ? (
          <span className="text-ui-xs text-foreground-subtle">
            {intl.formatMessage({ id: "settings.logs.view.rounds" })} · {records.length}
          </span>
        ) : null}
      </div>
      {summary.preview ? (
        <div className="shrink-0 border-b border-border bg-surface-hover/20 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
              {intl.formatMessage({ id: "settings.logs.conversation" })}
            </span>
            {summary.modelId ? (
              <span className="shrink-0 font-mono text-ui-xs text-foreground-subtle">
                {summary.modelId}
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-ui-sm text-foreground" title={summary.preview}>
            {summary.preview}
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "raw" ? (
          <RawRecords records={records} />
        ) : records.length > 0 ? (
          records.map((r, i) => <RoundCard key={i} record={r} index={i} />)
        ) : (
          <div className="p-6 text-center text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.logs.empty" })}
          </div>
        )}
      </div>
    </div>
  );
}
