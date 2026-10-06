import { getOpenNativeAICopy, type SupportedLocale, type UiLocale } from "@opennativeai/i18n";

export function formatCliHelp(
  version: string,
  locale?: UiLocale,
  detectedLocale?: SupportedLocale,
): string {
  return getOpenNativeAICopy(locale, detectedLocale).cli.help(version);
}
