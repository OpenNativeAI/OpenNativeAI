/**
 * V4 composer「思考深度」状态的单一所有者。
 *
 * 思考控件从右侧模型簇迁到输入框左区（完全访问右侧）后，可见控件（左区）与
 * e2e 锚点 TID_V4_MODEL_CONFIG 的 data-thought（仍留在右簇）需要读到同一份投影，
 * 因此档位计算与写回调上提到宿主（ConversationComposer）单点完成，再分别下发，
 * 避免两处各自推导造成状态漂移。写路径仍只有 onSelectThought 一条。
 */
import { useCallback, useMemo } from "react";
import type { OpenNativeAIConfigOption, OpenNativeAIProvider } from "@opennativeai/shared";
import type { ModelSelectionView } from "@opennativeai/services";
import type { SessionConfigState } from "@opennativeai/shared/opennativeai-protocol-v4";
import { getNextThoughtLevelValue } from "@/chat-input-toolbar/thoughtLevelOptions.js";
import { logger } from "@/logger.js";
import {
  resolveDraftDisplayedConfig,
  resolveDraftModelThoughtOption,
  resolveDraftThoughtCurrentValue,
} from "@/v4/composer/draftWorkspaceDefaults.js";

export interface V4ComposerThoughtParams {
  draftConfig?: Partial<SessionConfigState>;
  modelSelectionView?: ModelSelectionView | null;
  provider?: OpenNativeAIProvider;
  /** 选中思考深度；modelContext 固定本次用户操作的目标模型。 */
  onSelectThought: (thought: string, modelContext: { provider: string; model: string }) => void;
}

export interface V4ComposerThoughtState {
  /** 受控档位投影；无可选档位时为 null（控件不渲染）。 */
  thoughtOption: OpenNativeAIConfigOption | null;
  /** 下拉/受控 Select 的值变更回调。 */
  handleThoughtValueChange: (value: string) => void;
  /** Ctrl+T：按目录顺序循环下一次 Submission 的思考深度。 */
  handleCycleThoughtLevel: () => void;
}

export function useV4ComposerThought({
  draftConfig,
  modelSelectionView = null,
  onSelectThought,
}: V4ComposerThoughtParams): V4ComposerThoughtState {
  // 候选档位只来自目标 Host 的 ModelSelectionView，已选档位只来自 Composer。
  const effectiveConfig = useMemo(
    () => resolveDraftDisplayedConfig(draftConfig ?? {}),
    [draftConfig],
  );

  const draftModelThoughtOption = useMemo(
    () =>
      effectiveConfig
        ? resolveDraftModelThoughtOption(
            effectiveConfig.provider,
            effectiveConfig.model,
            modelSelectionView,
          )
        : null,
    [effectiveConfig, modelSelectionView],
  );

  const thoughtOption = useMemo<OpenNativeAIConfigOption | null>(() => {
    if (!effectiveConfig) return null;
    if (!draftModelThoughtOption) return null;
    return {
      ...draftModelThoughtOption,
      currentValue: resolveDraftThoughtCurrentValue({
        thought: effectiveConfig.thought,
        thoughtLevels: draftModelThoughtOption.options?.map((option) => option.value) ?? [],
      }),
    };
  }, [draftModelThoughtOption, effectiveConfig]);

  const handleThoughtValueChange = useCallback(
    (value: string) => {
      if (!effectiveConfig) return;
      if (!value.trim()) {
        // 跨模型受控 Select 重建时可能抛出一次空 value；它不是用户选择，
        // 若继续上抛会把模型 intent 标成 superseded，导致 accepted 模型无法写入全局元组。
        logger.debug("[v4-thought] ignore synthetic empty thought change", {
          model: effectiveConfig.model,
          provider: effectiveConfig.provider,
        });
        return;
      }
      onSelectThought(value, {
        provider: effectiveConfig.provider,
        model: effectiveConfig.model,
      });
    },
    [effectiveConfig, onSelectThought],
  );

  const handleCycleThoughtLevel = useCallback(() => {
    if (!thoughtOption || thoughtOption.type !== "select") {
      return;
    }
    const nextValue = getNextThoughtLevelValue(thoughtOption);
    if (nextValue == null) {
      return;
    }
    if (!effectiveConfig) return;
    onSelectThought(nextValue, {
      provider: effectiveConfig.provider,
      model: effectiveConfig.model,
    });
  }, [effectiveConfig, onSelectThought, thoughtOption]);

  return { thoughtOption, handleThoughtValueChange, handleCycleThoughtLevel };
}
