import { useCallback } from "react";
import type { AgentRuntimeSelection } from "@opennativeai/shared";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";
import { useSettings } from "@/hooks/useSettingService.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { toast } from "@/components/ui/toast.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { logger } from "@/logger.js";

const AGENT_RUNTIME_OPTIONS: AgentRuntimeSelection[] = ["default", "lite"];

/**
 * Agent 选择设置面板（全局切换）。
 * 唯一事实源在 AppSettings.agentRuntime；Host 在创建/恢复会话时读取本字段
 * 映射为协议 agentEngine 下发给 CLI 子进程（换芯方案，见
 * docs/specs/localagent-protocol-adapter.md）；运行中会话不迁移，
 * 引擎选择不随会话持久化（v1 边界，pendingNotice 文案明示）。
 */
export function AgentRuntimeSection() {
  const { intl } = useOpenNativeAIIntl();
  const { settings, update } = useSettings();
  // 缺失按默认值渲染，兼容老用户配置，无需数据迁移。
  const current: AgentRuntimeSelection = settings?.agentRuntime ?? "default";

  const handleChange = useCallback(
    async (value: string) => {
      const next = value as AgentRuntimeSelection;
      if (next === current) {
        return;
      }
      try {
        // 字面量键分支提交，规避计算键产生索引签名无法赋给 Partial<AppSettings> 的已知坑。
        if (next === "lite") {
          await update({ agentRuntime: "lite" });
        } else {
          await update({ agentRuntime: "default" });
        }
      } catch (error) {
        logger.warn("[settings.agentRuntime] 保存 Agent 选择失败", { error });
        toast(intl.formatMessage({ id: "settings.agentRuntime.saveFailed" }));
      }
    },
    [current, intl, update],
  );

  return (
    <div className="space-y-6">
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.agentRuntime.select" })}
          description={
            <div className="space-y-1">
              <p>{intl.formatMessage({ id: "settings.agentRuntime.select.description" })}</p>
              <p>{intl.formatMessage({ id: "settings.agentRuntime.pendingNotice" })}</p>
            </div>
          }
          control={
            <Select value={current} onValueChange={(value) => void handleChange(value)}>
              <SelectTrigger size="lg" className="w-[260px] min-w-0 justify-between">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENT_RUNTIME_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {intl.formatMessage({
                      id: `settings.agentRuntime.option.${option}`,
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsGroupCard>
    </div>
  );
}
