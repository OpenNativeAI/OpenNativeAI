/**
 * 多模态设置 — 单模型行
 * UI 极简化:左侧序号、中间模型名输入框、右侧删除按钮。
 * 模型名以纯文本方式输入,提交时按 trim 后的字符串透传,不做候选 / 校验。
 */
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { cn } from "@/components/lib/utils.js";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";

export interface MultimodalModelEntry {
  id: string;
  name: string;
  enabled: boolean;
}

export function MultimodalModelListRow({
  model,
  index,
  isLast,
  onChange,
  onDelete,
}: {
  model: MultimodalModelEntry;
  index: number;
  isLast: boolean;
  onChange: (patch: Partial<MultimodalModelEntry>) => void;
  onDelete: () => void;
}) {
  const { intl } = useOpenNativeAIIntl();

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-2.5",
        isLast ? "" : "border-b border-input-border",
      )}
    >
      <span className="w-6 shrink-0 text-ui-base text-foreground-subtlest">
        {String(index + 1).padStart(2, "0")}
      </span>
      <Input
        {...TECHNICAL_INPUT_ATTRIBUTES}
        size="lg"
        className="h-8 flex-1 min-w-32 font-mono"
        value={model.name}
        onChange={(event) => onChange({ name: event.target.value })}
        placeholder={intl.formatMessage({ id: "mediaStudio.config.modelNamePlaceholder" })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={intl.formatMessage({ id: "mediaStudio.config.model.delete" })}
        title={intl.formatMessage({ id: "mediaStudio.config.model.delete" })}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
