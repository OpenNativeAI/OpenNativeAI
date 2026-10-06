import type { OpenNativeAIMessageWithParts } from "./opennativeai-protocol-legacy-types.js";
import { textFromOpenNativeAIMessageParts } from "./opennativeai-protocol-legacy-types.js";
import type { OpenNativeAIStreamEvent } from "./opennativeai-task-types-core.js";

export interface OpenNativeAIBackgroundTaskNotificationInfo {
  error?: string;
  outputFile?: string;
  result?: string;
  status?: string;
  summary?: string;
  taskId?: string;
}

export function parseOpenNativeAIBackgroundTaskNotificationText(
  text: string | undefined,
): { notification: OpenNativeAIBackgroundTaskNotificationInfo; toolUseId: string } | null {
  const trimmed = text?.trim();
  if (!trimmed?.startsWith("<task-notification>")) {
    return null;
  }
  const toolUseId = readTaskNotificationTag(trimmed, "tool-use-id");
  if (!toolUseId) {
    return null;
  }
  return {
    toolUseId,
    notification: {
      error: readTaskNotificationTag(trimmed, "error"),
      outputFile: readTaskNotificationTag(trimmed, "output-file"),
      result: readTaskNotificationTag(trimmed, "result"),
      status: readTaskNotificationTag(trimmed, "status"),
      summary: readTaskNotificationTag(trimmed, "summary"),
      taskId: readTaskNotificationTag(trimmed, "task-id"),
    },
  };
}

export function collectOpenNativeAIBackgroundTaskNotificationsByToolUseId(
  messages: readonly OpenNativeAIMessageWithParts[],
): Map<string, OpenNativeAIBackgroundTaskNotificationInfo> {
  const notifications = new Map<string, OpenNativeAIBackgroundTaskNotificationInfo>();
  for (const message of messages) {
    if (message.info.role !== "user") {
      continue;
    }
    const parsed = parseOpenNativeAIBackgroundTaskNotificationText(
      textFromOpenNativeAIMessageParts(message.parts),
    );
    if (!parsed) {
      continue;
    }
    notifications.set(parsed.toolUseId, parsed.notification);
  }
  return notifications;
}

export function opennativeaiBackgroundTaskNotificationToolUpdateStatus(
  status: string | undefined,
): Extract<
  Extract<OpenNativeAIStreamEvent, { type: "tool_call_update" }>["status"],
  "completed" | "failed" | "stopped"
> {
  if (status === "failed" || status === "lost") {
    return "failed";
  }
  // task-notification 的 killed/stopped 都表示被停止，不能折成 completed。
  if (status === "stopped" || status === "killed") {
    return "stopped";
  }
  return "completed";
}

export function attachOpenNativeAIBackgroundTaskNotificationToRaw(
  raw: unknown,
  notification: OpenNativeAIBackgroundTaskNotificationInfo | undefined,
): unknown {
  if (!notification) {
    return raw;
  }
  const record = asPlainRecord(raw);
  const meta = asPlainRecord(record._meta);
  const opennativeai = asPlainRecord(meta.opennativeai);
  return {
    ...record,
    _meta: {
      ...meta,
      opennativeai: {
        ...opennativeai,
        taskNotification: notification,
      },
    },
  };
}

function readTaskNotificationTag(text: string, tag: string): string | undefined {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "u"));
  const value = match?.[1]?.trim();
  return value ? decodeTaskNotificationXmlText(value) : undefined;
}

function decodeTaskNotificationXmlText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function asPlainRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
