/**
 * V4 composer 左区「思考深度」控件。
 *
 * 迁移背景：思考原先长在右侧模型簇（贴着发送键），现按产品要求放到整个输入框
 * 的左区、完全访问（模式切换）右侧。为了保持「状态单一所有者」，档位投影与写回调
 * 由宿主经 useV4ComposerThought 单点计算后作为 props 下发；本组件只负责呈现与
 * Ctrl+T 热键绑定（仿 V4ComposerModeSwitch 的自绑范式，只声明自己拥有的选项）。
 */
import { memo, useCallback, useRef } from "react";
import {
  TID_V4_COMPOSER_INPUT,
  OPENNATIVEAI_AGENT_PROVIDER,
  type OpenNativeAIConfigOption,
  type OpenNativeAIProvider,
} from "@opennativeai/shared";
import { ThoughtLevelCycleControl } from "@/chat-input-toolbar/ThoughtLevelCycleControl.js";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";
import { useShortcutCommandLabel } from "@/shortcuts/useShortcutBindings.js";
import { useToolbarShortcutBindings } from "@/v4/composer/toolbarShortcuts.js";
import type { V4ComposerConfigPicker } from "@/v4/composer/configPickerState.js";

const V4_COMPOSER_INPUT_SELECTOR = `[data-testid="${TID_V4_COMPOSER_INPUT}"]`;

/** 本控件不拥有模型/模式热键，占位保持 useToolbarShortcutBindings 单实例语义。 */
function noop(): void {}

export interface V4ComposerThoughtSwitchProps {
  /** 由宿主单点计算的受控档位投影；为 null 时不渲染。 */
  thoughtOption: OpenNativeAIConfigOption | null;
  provider?: OpenNativeAIProvider;
  disabled: boolean;
  activeConfigPicker: V4ComposerConfigPicker | null;
  onConfigPickerOpenChange: (picker: V4ComposerConfigPicker, open: boolean) => void;
  onValueChange: (value: string) => void;
  onCycleThoughtLevel: () => void;
}

function V4ComposerThoughtSwitchImpl({
  thoughtOption,
  provider,
  disabled,
  activeConfigPicker,
  onConfigPickerOpenChange,
  onValueChange,
  onCycleThoughtLevel,
}: V4ComposerThoughtSwitchProps) {
  const { intl } = useOpenNativeAIIntl();
  const displayProvider = provider ?? OPENNATIVEAI_AGENT_PROVIDER;
  const thoughtTriggerRef = useRef<HTMLSpanElement | null>(null);
  const thoughtShortcutLabel = useShortcutCommandLabel("cycleThoughtLevel");
  const handleThoughtPickerOpenChange = useCallback(
    (open: boolean) => {
      onConfigPickerOpenChange("thought", open);
    },
    [onConfigPickerOpenChange],
  );
  // Ctrl+T 热键随控件迁入左区：只声明 thoughtOption，其余动作占位，
  // resolveToolbarShortcutAction 会跳过未拥有的选项，避免与模型/模式热键重复触发。
  useToolbarShortcutBindings({
    hasAnyOption: Boolean(thoughtOption),
    toolbarDisabled: disabled,
    modelMenuDisabled: true,
    thoughtOption: thoughtOption ?? undefined,
    onOpenModelMenu: noop,
    onCycleSessionMode: noop,
    onCycleThoughtLevel,
  });
  if (!thoughtOption) return null;
  return (
    <ThoughtLevelCycleControl
      indicatorClassName="hidden @xl/composer:block"
      triggerClassName="@max-sm/composer:size-7 @max-sm/composer:justify-center @max-sm/composer:p-0"
      option={thoughtOption}
      onValueChange={onValueChange}
      disabled={disabled}
      showIcon={false}
      intl={intl}
      provider={displayProvider}
      shortcutLabel={thoughtShortcutLabel}
      triggerRef={thoughtTriggerRef}
      open={activeConfigPicker === "thought"}
      onOpenChange={handleThoughtPickerOpenChange}
      restoreFocusSelector={V4_COMPOSER_INPUT_SELECTOR}
    />
  );
}

export const V4ComposerThoughtSwitch = memo(V4ComposerThoughtSwitchImpl);
