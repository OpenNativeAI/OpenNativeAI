import { DEFAULT_OPENNATIVEAI_ENDPOINT_ORIGIN } from "./opennativeaiEndpoint.js";

export const OPENNATIVEAI_SOURCE_HEADERS = {
  "User-Agent": "OpenNativeAI/unknown",
  "HTTP-Referer": DEFAULT_OPENNATIVEAI_ENDPOINT_ORIGIN,
  "X-Title": "Z Code@electron",
} as const;

export interface BuildOpenNativeAISourceHeadersFromContextOptions {
  appVersion?: string;
  arch?: string;
  clientLanguage?: string;
  clientTimezone?: string;
  deviceMid?: string;
  endpointOrigin?: string;
  osVersion?: string;
  platform?: string;
  releaseChannel?: string;
  sourceTitle?: string;
}

export function normalizeOpenNativeAISourceHeaderValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[\x20-\x7e]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function buildOpenNativeAISourceHeadersFromContext(
  options: BuildOpenNativeAISourceHeadersFromContextOptions = {},
): Record<string, string> {
  const appVersion = normalizeOpenNativeAISourceHeaderValue(options.appVersion);
  const arch = normalizeOpenNativeAISourceHeaderValue(options.arch);
  const clientLanguage = normalizeOpenNativeAISourceHeaderValue(options.clientLanguage) ?? "unknown";
  const clientTimezone = normalizeOpenNativeAISourceHeaderValue(options.clientTimezone) ?? "unknown";
  const deviceMid = normalizeOpenNativeAISourceHeaderValue(options.deviceMid);
  const endpointOrigin =
    normalizeOpenNativeAISourceHeaderValue(options.endpointOrigin) ?? DEFAULT_OPENNATIVEAI_ENDPOINT_ORIGIN;
  const osVersion = normalizeOpenNativeAISourceHeaderValue(options.osVersion);
  const platform = normalizeOpenNativeAISourceHeaderValue(options.platform);
  const releaseChannel = normalizeOpenNativeAISourceHeaderValue(options.releaseChannel);
  const sourceTitle = normalizeOpenNativeAISourceHeaderValue(options.sourceTitle) ?? "electron";

  return {
    ...OPENNATIVEAI_SOURCE_HEADERS,
    "HTTP-Referer": endpointOrigin,
    "User-Agent": `OpenNativeAI/${appVersion ?? "unknown"}`,
    ...(appVersion ? { "X-OpenNativeAI-App-Version": appVersion } : {}),
    "X-Title": `Z Code@${sourceTitle}`,
    ...(platform && arch ? { "X-Platform": `${platform}-${arch}` } : {}),
    ...(releaseChannel ? { "X-Release-Channel": releaseChannel } : {}),
    "X-Client-Language": clientLanguage,
    "X-Client-Timezone": clientTimezone,
    ...(platform ? { "X-Os-Category": normalizeOsCategory(platform) } : {}),
    ...(osVersion ? { "X-Os-Version": osVersion } : {}),
    ...(deviceMid ? { "X-Device-Mid": deviceMid } : {}),
  };
}

function normalizeOsCategory(platform: string): string {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}
