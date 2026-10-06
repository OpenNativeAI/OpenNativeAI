import type { ConfigResult } from "@opennativeai/adapters/config";
import { detectLocale, resolveLocale } from "@opennativeai/i18n";
import type { RuntimeConfigPatch, SupportedLocale, UiLocale } from "@opennativeai/contracts";
import type { OpenNativeAIAppOptions } from "./types.js";

export function isMessageEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.OPENNATIVEAI_MESSAGE_ENABLED === "1" || env.OPENNATIVEAI_MESSAGE_ENABLED === "true";
}

export function createConfigCliOverrides(options: OpenNativeAIAppOptions): RuntimeConfigPatch | undefined {
  const overrides: RuntimeConfigPatch = {};
  const permission: NonNullable<RuntimeConfigPatch["permission"]> = {};

  if (options.runtimeConfig?.mode) {
    permission.mode = options.runtimeConfig.mode;
  }
  if (options.runtimeConfig?.toolAllowlist) {
    permission.allowedTools = [...options.runtimeConfig.toolAllowlist];
  }
  if (options.runtimeConfig?.toolDisallowlist) {
    // headless CLI 的 denylist 同时投影到 permission config，让执行期权限
    // 路径与 provider-visible 工具面共享同一份禁用清单。
    permission.disallowedTools = [...options.runtimeConfig.toolDisallowlist];
  }
  if (Object.keys(permission).length > 0) {
    overrides.permission = permission;
  }
  if (options.uiLocale) {
    overrides.ui = {
      locale: options.uiLocale,
    };
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export function resolveEffectiveConfigResult(
  configResult: ConfigResult,
  options: OpenNativeAIAppOptions,
): ConfigResult {
  const requestedLocale = configResult.config.ui.locale;
  const effectiveLocale = resolveEffectiveLocale(requestedLocale, options);

  if (effectiveLocale === requestedLocale) {
    return configResult;
  }

  return {
    ...configResult,
    config: {
      ...configResult.config,
      ui: {
        ...configResult.config.ui,
        locale: effectiveLocale,
      },
    },
  };
}

export function resolveEffectiveLocale(
  requestedLocale: UiLocale,
  options: OpenNativeAIAppOptions,
): SupportedLocale {
  const detectedLocale = requestedLocale === "auto" ? detectAppLocale(options) : undefined;
  return resolveLocale(requestedLocale, detectedLocale);
}

function detectAppLocale(options: OpenNativeAIAppOptions): SupportedLocale | undefined {
  if (options.uiDetectedLocale !== undefined) {
    return detectLocale({
      intlLocale: options.uiDetectedLocale,
    });
  }

  return detectLocale({
    env: options.env ?? process.env,
    intlLocale: resolveIntlLocale(),
  });
}

function resolveIntlLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}
