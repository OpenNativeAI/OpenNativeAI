/**
 * LLM 错误分类层 —— 把 HTTP / 流式 / 网络 / 取消 等所有错误
 * 归一化成结构化 LlmErrorInfo,前端按 code 决定 UI(重试按钮/设置跳转/普通提示)。
 *
 * 设计原则:
 * - technical: 给开发者/日志看的原始信息(可含 status / 原始 body)
 * - user:      给用户看的中文友好提示
 * - retryable: 是否可重试(限流/网络/服务端 = true,auth/参数错 = false)
 */

export type LlmErrorCode =
  | "rate_limit" // 429 触发限流
  | "quota_exceeded" // 403/额度耗尽
  | "auth_invalid" // 401 / API key 无效
  | "auth_denied" // 403 / 权限不足
  | "not_found" // 404 / 模型不存在
  | "bad_request" // 400 / 请求格式错
  | "context_too_long" // 400 + context/token 关键词
  | "server_error" // 5xx
  | "network" // DNS/连接失败
  | "timeout" // 超时
  | "cancelled" // 用户/系统主动取消
  | "tool_error" // 工具执行失败
  | "unknown";

export interface LlmErrorInfo {
  code: LlmErrorCode;
  technical: string;
  user: string;
  retryable: boolean;
  status?: number;
  provider?: string;
}

const USER_MESSAGES: Record<LlmErrorCode, string> = {
  rate_limit: "调用频率过高,触发限流。请稍候片刻再试,或在设置中降低请求频率。",
  quota_exceeded: "账户额度已用完。请充值或更换 API key 后再试。",
  auth_invalid: "API key 无效或已过期。请到设置页检查并更新密钥。",
  auth_denied: "访问被拒绝。可能是 API key 权限不足或账户被封禁。",
  not_found: "模型不存在或已下线。请检查模型名称是否正确。",
  bad_request: "请求格式有误,模型无法理解。",
  context_too_long: "对话上下文过长,超出模型窗口。请新建会话或压缩历史。",
  server_error: "AI 服务端异常。请稍后重试。",
  network: "网络连接失败。请检查网络或代理设置。",
  timeout: "请求超时。请稍后重试。",
  cancelled: "已取消当前任务。",
  tool_error: "工具执行失败,请查看上方错误详情。",
  unknown: "未知错误,请重试或查看日志。",
};

const RETRYABLE: Record<LlmErrorCode, boolean> = {
  rate_limit: true,
  quota_exceeded: false,
  auth_invalid: false,
  auth_denied: false,
  not_found: false,
  bad_request: false,
  context_too_long: false,
  server_error: true,
  network: true,
  timeout: true,
  cancelled: false,
  tool_error: false,
  unknown: true,
};

function info(
  code: LlmErrorCode,
  technical: string,
  status?: number,
  provider?: string,
): LlmErrorInfo {
  return {
    code,
    technical,
    user: USER_MESSAGES[code],
    retryable: RETRYABLE[code],
    status,
    provider,
  };
}

/** HTTP 非 2xx 的归类 */
export function classifyHttpError(status: number, body: string, provider?: string): LlmErrorInfo {
  const snippet = body.slice(0, 500);
  const lower = snippet.toLowerCase();
  switch (status) {
    case 400:
      if (
        lower.includes("context") ||
        lower.includes("too long") ||
        lower.includes("maximum") ||
        lower.includes("token")
      ) {
        return info("context_too_long", `HTTP 400 ${snippet}`, status, provider);
      }
      return info("bad_request", `HTTP 400 ${snippet}`, status, provider);
    case 401:
      return info("auth_invalid", `HTTP 401 ${snippet}`, status, provider);
    case 403:
      if (
        lower.includes("quota") ||
        lower.includes("额度") ||
        lower.includes("billing") ||
        lower.includes("insufficient")
      ) {
        return info("quota_exceeded", `HTTP 403 ${snippet}`, status, provider);
      }
      return info("auth_denied", `HTTP 403 ${snippet}`, status, provider);
    case 404:
      return info("not_found", `HTTP 404 ${snippet}`, status, provider);
    case 429:
      return info("rate_limit", `HTTP 429 ${snippet}`, status, provider);
    default:
      if (status >= 500 && status < 600) {
        return info("server_error", `HTTP ${status} ${snippet}`, status, provider);
      }
      return info("unknown", `HTTP ${status} ${snippet}`, status, provider);
  }
}

/** fetch 抛错的归类(网络/超时/取消) */
export function classifyFetchError(err: unknown, provider?: string): LlmErrorInfo {
  const e = err as { name?: string; message?: string };
  const msg = String(e?.message ?? err);
  if (e?.name === "AbortError" || msg.toLowerCase().includes("abort")) {
    return info("cancelled", msg, undefined, provider);
  }
  if (msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("timed out")) {
    return info("timeout", msg, undefined, provider);
  }
  return info("network", msg, undefined, provider);
}

/** 用户主动 cancelTurn */
export function classifyCancelled(): LlmErrorInfo {
  return info("cancelled", "user cancelled");
}

/** 流式过程中协议层抛错的归类 */
export function classifyStreamError(err: unknown, provider?: string): LlmErrorInfo {
  const msg = String((err as { message?: unknown })?.message ?? err);
  const lower = msg.toLowerCase();
  if (lower.includes("rate") || lower.includes("429") || lower.includes("limit")) {
    return info("rate_limit", msg, undefined, provider);
  }
  if (lower.includes("context") && lower.includes("long")) {
    return info("context_too_long", msg, undefined, provider);
  }
  if (lower.includes("unauthorized") || lower.includes("api key")) {
    return info("auth_invalid", msg, undefined, provider);
  }
  if (
    lower.includes("server") ||
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503")
  ) {
    return info("server_error", msg, undefined, provider);
  }
  return info("unknown", msg, undefined, provider);
}

/** 工具执行失败的归类 */
export function classifyToolError(message: string): LlmErrorInfo {
  return info("tool_error", message);
}

/** 把任意 error 规范化成 LlmErrorInfo(已在抛出处打过标记的优先,否则降级到 unknown) */
export function normalizeError(err: unknown, provider?: string): LlmErrorInfo {
  const tagged = (err as { llmError?: LlmErrorInfo } | null | undefined)?.llmError;
  if (tagged) return tagged;
  return info(
    "unknown",
    String((err as { message?: unknown })?.message ?? err),
    undefined,
    provider,
  );
}

/** 给 Error 实例挂上 LlmErrorInfo 标记(供上游 classify 后通过) */
export function tagError(err: Error, infoValue: LlmErrorInfo): Error {
  (err as Error & { llmError?: LlmErrorInfo }).llmError = infoValue;
  return err;
}
