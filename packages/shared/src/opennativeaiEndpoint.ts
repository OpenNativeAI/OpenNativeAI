import type { OpenNativeAIEnv } from "./env.js";

export const DEFAULT_OPENNATIVEAI_ENDPOINT_ORIGIN = "https://opennativeai.z.ai";
export const DEFAULT_BIGMODEL_API_ORIGIN = "https://bigmodel.cn";
export const DEFAULT_ZAI_OAUTH_ORIGIN = "https://chat.z.ai";
export const DEFAULT_ZAI_BUSINESS_BASE_URL = "https://api.z.ai";
export const DEFAULT_ZAI_OAUTH_CLIENT_ID = "client_P8X5CMWmlaRO9gyO-KSqtg";

// 构建仅注入公开链接；Node 调用方仍可显式传 env，避免读取另一进程的配置。
declare const __OPENNATIVEAI_ENDPOINT_ENV__: Record<string, string | undefined> | undefined;
export function pickProductEndpointEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const keys = [
    "OPENNATIVEAI_BASE_URL",
    "OPENNATIVEAI_ENDPOINT_ORIGIN",
    "BIGMODEL_API_BASE_URL",
    "ZAI_OAUTH_ORIGIN",
    "ZAI_BUSINESS_BASE_URL",
    "ZAI_OAUTH_CLIENT_ID",
    "ZAI_OAUTH_APP_ID",
  ];
  return Object.fromEntries(
    keys.flatMap((key) => (env[key]?.trim() ? [[key, env[key]!.trim()]] : [])),
  );
}
export function readProductEndpointEnv(): Record<string, string | undefined> {
  return {
    ...(typeof __OPENNATIVEAI_ENDPOINT_ENV__ === "undefined" ? {} : __OPENNATIVEAI_ENDPOINT_ENV__),
    ...pickProductEndpointEnv(typeof process === "undefined" ? {} : process.env),
  };
}

export interface OpenNativeAIEndpointUrls {
  origin: string;
  apiBaseUrl: string;
  webShareCallbackUrl: string;
  opennativeaiPlanOpenAiBaseUrl: string;
  opennativeaiPlanAnthropicBaseUrl: string;
  opennativeaiPlanBillingCurrentUrl: string;
  opennativeaiPlanBillingBalanceUrl: string;
}

export interface RuntimeOpenNativeAIEndpointEnv {
  [key: string]: string | undefined;
  OPENNATIVEAI_ENV?: string;
  OPENNATIVEAI_BASE_URL?: string;
  OPENNATIVEAI_ENDPOINT_ORIGIN?: string;
}

export interface RuntimeBigModelApiEnv {
  [key: string]: string | undefined;
  OPENNATIVEAI_ENV?: string;
  BIGMODEL_API_BASE_URL?: string;
}

export interface RuntimeZaiEndpointEnv {
  [key: string]: string | undefined;
  OPENNATIVEAI_ENV?: string;
  ZAI_OAUTH_ORIGIN?: string;
  ZAI_BUSINESS_BASE_URL?: string;
  ZAI_OAUTH_CLIENT_ID?: string;
  ZAI_OAUTH_APP_ID?: string;
}

export interface RuntimeProductEndpointEnv
  extends RuntimeOpenNativeAIEndpointEnv, RuntimeBigModelApiEnv, RuntimeZaiEndpointEnv {}

export interface RuntimeProductEndpointConfig {
  opennativeaiEnv: OpenNativeAIEnv;
  opennativeaiEndpointOrigin: string;
  opennativeaiEndpointUrls: OpenNativeAIEndpointUrls;
  zaiOAuthOrigin: string;
  zaiBusinessBaseUrl: string;
  zaiOAuthClientId: string;
  bigModelApiOrigin: string;
}

function readRuntimeEnvValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function normalizeOpenNativeAIEndpointOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("OpenNativeAI endpoint origin is empty");
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("OpenNativeAI endpoint origin must use http or https");
  }
  return parsed.origin;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isTrustedCodingPlanWebviewOrigin(
  value: string | null | undefined,
  options?: {
    e2eStoreBridgeEnabled?: boolean;
  },
): boolean {
  if (!value) return false;
  try {
    const origin = normalizeOpenNativeAIEndpointOrigin(value);
    if (
      origin === DEFAULT_OPENNATIVEAI_ENDPOINT_ORIGIN ||
      origin === resolveRuntimeOpenNativeAIEndpointOrigin()
    ) {
      return true;
    }
    const parsed = new URL(origin);
    return options?.e2eStoreBridgeEnabled === true && isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function resolveOpenNativeAIEndpointOrigin(options?: {
  env?: OpenNativeAIEnv;
  envBaseOrigin?: string | null;
  overrideOrigin?: string | null;
}): string {
  const origin = options?.overrideOrigin?.trim() || options?.envBaseOrigin?.trim();
  return origin ? normalizeOpenNativeAIEndpointOrigin(origin) : DEFAULT_OPENNATIVEAI_ENDPOINT_ORIGIN;
}

export function resolveRuntimeOpenNativeAIEnv(
  env: RuntimeOpenNativeAIEndpointEnv = readProductEndpointEnv(),
): OpenNativeAIEnv {
  // 产品身份仅用于既有展示与安装标识，不参与地址解析。
  return env.OPENNATIVEAI_ENV?.trim().toLowerCase() === "test" ? "test" : "production";
}

export function resolveRuntimeOpenNativeAIEndpointOrigin(
  env: RuntimeOpenNativeAIEndpointEnv = readProductEndpointEnv(),
  options?: { overrideOrigin?: string | null },
): string {
  return resolveOpenNativeAIEndpointOrigin({
    envBaseOrigin:
      readRuntimeEnvValue(env, "OPENNATIVEAI_BASE_URL") ??
      readRuntimeEnvValue(env, "OPENNATIVEAI_ENDPOINT_ORIGIN"),
    overrideOrigin: options?.overrideOrigin,
  });
}

export function buildRuntimeOpenNativeAIEndpointUrls(
  env: RuntimeOpenNativeAIEndpointEnv = readProductEndpointEnv(),
): OpenNativeAIEndpointUrls {
  return buildOpenNativeAIEndpointUrls(resolveRuntimeOpenNativeAIEndpointOrigin(env));
}

export function buildRuntimeOpenNativeAIApiUrl(
  env: RuntimeOpenNativeAIEndpointEnv = readProductEndpointEnv(),
  path: string,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveRuntimeOpenNativeAIEndpointOrigin(env)}${normalizedPath}`;
}

export function resolveBigModelApiOrigin(
  env: RuntimeBigModelApiEnv = readProductEndpointEnv(),
): string {
  return normalizeOpenNativeAIEndpointOrigin(
    readRuntimeEnvValue(env, "BIGMODEL_API_BASE_URL") ?? DEFAULT_BIGMODEL_API_ORIGIN,
  );
}

export function buildBigModelApiUrl(
  env: RuntimeBigModelApiEnv = readProductEndpointEnv(),
  path: string,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveBigModelApiOrigin(env)}${normalizedPath}`;
}

export function buildBigModelCodingPlanPersonalManageUrl(
  env: RuntimeBigModelApiEnv = readProductEndpointEnv(),
): string {
  // 管理页与业务 API 共用显式 origin，避免把已登录账号带到另一个部署。
  return buildBigModelApiUrl(env, "/coding-plan/personal/overview");
}

export function buildBigModelCodingPlanTeamManageUrl(
  env: RuntimeBigModelApiEnv = readProductEndpointEnv(),
): string {
  return buildBigModelApiUrl(env, "/coding-plan/team/plans");
}

export function resolveZaiOAuthOrigin(
  env: RuntimeZaiEndpointEnv = readProductEndpointEnv(),
): string {
  return normalizeOpenNativeAIEndpointOrigin(
    readRuntimeEnvValue(env, "ZAI_OAUTH_ORIGIN") ?? DEFAULT_ZAI_OAUTH_ORIGIN,
  );
}

export function resolveZaiBusinessBaseUrl(
  env: RuntimeZaiEndpointEnv = readProductEndpointEnv(),
): string {
  return normalizeOpenNativeAIEndpointOrigin(
    readRuntimeEnvValue(env, "ZAI_BUSINESS_BASE_URL") ?? DEFAULT_ZAI_BUSINESS_BASE_URL,
  );
}

export function resolveZaiOAuthClientId(
  env: RuntimeZaiEndpointEnv = readProductEndpointEnv(),
): string {
  return (
    readRuntimeEnvValue(env, "ZAI_OAUTH_CLIENT_ID") ??
    readRuntimeEnvValue(env, "ZAI_OAUTH_APP_ID") ??
    DEFAULT_ZAI_OAUTH_CLIENT_ID
  );
}

export function buildZaiOAuthUrl(origin: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeOpenNativeAIEndpointOrigin(origin)}${normalizedPath}`;
}

export function buildRuntimeZaiOAuthUrl(
  env: RuntimeZaiEndpointEnv = readProductEndpointEnv(),
  path: string,
): string {
  return buildZaiOAuthUrl(resolveZaiOAuthOrigin(env), path);
}

export function buildRuntimeZaiBusinessUrl(
  env: RuntimeZaiEndpointEnv = readProductEndpointEnv(),
  path: string,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveZaiBusinessBaseUrl(env)}${normalizedPath}`;
}

export function resolveRuntimeProductEndpointConfig(
  env: RuntimeProductEndpointEnv = readProductEndpointEnv(),
): RuntimeProductEndpointConfig {
  const opennativeaiEnv = resolveRuntimeOpenNativeAIEnv(env);
  const opennativeaiEndpointOrigin = resolveRuntimeOpenNativeAIEndpointOrigin(env);

  return {
    opennativeaiEnv,
    opennativeaiEndpointOrigin,
    opennativeaiEndpointUrls: buildOpenNativeAIEndpointUrls(opennativeaiEndpointOrigin),
    zaiOAuthOrigin: resolveZaiOAuthOrigin(env),
    zaiBusinessBaseUrl: resolveZaiBusinessBaseUrl(env),
    zaiOAuthClientId: resolveZaiOAuthClientId(env),
    bigModelApiOrigin: resolveBigModelApiOrigin(env),
  };
}

export function buildOpenNativeAIEndpointUrls(origin: string): OpenNativeAIEndpointUrls {
  const normalizedOrigin = normalizeOpenNativeAIEndpointOrigin(origin);
  return {
    origin: normalizedOrigin,
    apiBaseUrl: `${normalizedOrigin}/api/v1`,
    webShareCallbackUrl: `${normalizedOrigin}/cn/share/callback`,
    opennativeaiPlanOpenAiBaseUrl: `${normalizedOrigin}/api/v1/opennativeai-plan`,
    opennativeaiPlanAnthropicBaseUrl: `${normalizedOrigin}/api/v1/opennativeai-plan/anthropic`,
    opennativeaiPlanBillingCurrentUrl: `${normalizedOrigin}/api/v1/opennativeai-plan/billing/current`,
    opennativeaiPlanBillingBalanceUrl: `${normalizedOrigin}/api/v1/opennativeai-plan/billing/balance`,
  };
}

export function rewriteOpenNativeAIEndpointUrl(input: string | URL, endpointOrigin: string): string | URL {
  const originalUrl = typeof input === "string" ? input : input.toString();
  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return input;
  }
  const sourceOrigin = DEFAULT_OPENNATIVEAI_ENDPOINT_ORIGIN;
  if (parsed.origin !== sourceOrigin) {
    return input;
  }

  const targetOrigin = normalizeOpenNativeAIEndpointOrigin(endpointOrigin);
  if (targetOrigin === sourceOrigin) {
    return input;
  }

  const target = new URL(targetOrigin);
  target.pathname = parsed.pathname;
  target.search = parsed.search;
  target.hash = parsed.hash;
  return target.toString();
}
