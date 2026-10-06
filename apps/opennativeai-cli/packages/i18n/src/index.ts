import type { UiLocale, SupportedLocale } from "@opennativeai/contracts";
import { enUS } from "./locales/en-US.js";
import { zhCN } from "./locales/zh-CN.js";
import {
  DEFAULT_LOCALE,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
} from "./locale.js";
import type { OpenNativeAICopy } from "./types.js";

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
};
export type { LocaleDetectionInput } from "./locale.js";
export type { CliCopy, TuiCopy, UiLocale, SupportedLocale, OpenNativeAICopy } from "./types.js";

const CATALOGS: Record<SupportedLocale, OpenNativeAICopy> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

export function getOpenNativeAICopy(locale?: UiLocale | string, detected?: string | null): OpenNativeAICopy {
  return CATALOGS[resolveLocale(locale, detected)];
}
