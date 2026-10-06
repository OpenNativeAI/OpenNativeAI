import { OPENNATIVEAI_VERSION, type OpenNativeAIEnv } from "@opennativeai/shared";

declare const __OPENNATIVEAI_CDN_BASE_URL__: string | undefined;
const DEFAULT_CDN_BASE_URL = "https://cdn-opennativeai.z.ai";

export interface ResolveRemoteCdnOptions {
  env?: OpenNativeAIEnv;
  locale?: string;
  timeZone?: string;
  overrideBaseUrl?: string;
  version?: string;
  now?: Date;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("CDN URL must use http or https");
  return value.replace(/\/+$/, "");
}

export function resolveRemoteCdnBaseUrls(options: ResolveRemoteCdnOptions = {}): string[] {
  const override = options.overrideBaseUrl?.trim();
  if (override) return [normalizeBaseUrl(override)];
  const baseUrl =
    process.env.OPENNATIVEAI_CDN_BASE_URL?.trim() ||
    (typeof __OPENNATIVEAI_CDN_BASE_URL__ === "undefined" ? "" : __OPENNATIVEAI_CDN_BASE_URL__) ||
    DEFAULT_CDN_BASE_URL;
  return [
    `${normalizeBaseUrl(baseUrl)}/opennativeai/electron/releases/${options.version ?? OPENNATIVEAI_VERSION}`,
  ];
}
