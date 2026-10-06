import { BUILTIN_MODEL_PROVIDER_IDS, type ProviderFamilyDomain } from "@opennativeai/shared";
import type { SidebarUsageCodingPlanProviderId } from "@/lib/sidebarUsageCodingPlanProviderPreference.js";

export function resolveSidebarCodingPlanUpgradeFallbackProviderId(
  providerFamilyDomain: ProviderFamilyDomain | null,
): SidebarUsageCodingPlanProviderId {
  // API Key 模式不会为 Coding Plan provider 注入套餐 key，头像入口因而
  // 无法从权益或用量来源推导 provider；按 provider 家族域名回退到对应品牌的入口。
  return providerFamilyDomain === "bigmodel"
    ? BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan
    : BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan;
}
