/**
 * MediaStudioSizeSelect —— 创作面板的尺寸选择器。
 * 每个选项带一个按真实宽高比缩放的矩形图形，直观展示输出形状；
 * 「自动」表示不传 size、由模型默认决定（Radix SelectItem 不允许空串 value，用哨兵值）。
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";

export const MEDIA_STUDIO_SIZE_AUTO = "auto";

/** box 是按真实宽高比缩放的图形尺寸（长边 18px），用于在选项里直观展示比例。 */
const IMAGE_SIZE_OPTIONS = [
  { value: "1024x1024", label: "1:1 · 1024×1024", box: { w: 18, h: 18 } },
  { value: "1536x1024", label: "3:2 · 1536×1024", box: { w: 18, h: 12 } },
  { value: "1024x1536", label: "2:3 · 1024×1536", box: { w: 12, h: 18 } },
  { value: "1536x864", label: "16:9 · 1536×864", box: { w: 18, h: 10 } },
  { value: "864x1536", label: "9:16 · 864×1536", box: { w: 10, h: 18 } },
];

export function MediaStudioSizeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { intl } = useOpenNativeAIIntl();
  return (
    <label className="mb-2 flex w-full flex-col gap-1">
      <span className="text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "mediaStudio.create.size" })}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-full font-mono">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={MEDIA_STUDIO_SIZE_AUTO}>
            <span className="flex items-center gap-2">
              {/* 虚线方框：不指定尺寸，由模型默认决定。 */}
              <span
                aria-hidden
                className="size-[14px] shrink-0 rounded-[2px] border border-dashed border-current"
              />
              {intl.formatMessage({ id: "mediaStudio.create.size.auto" })}
            </span>
          </SelectItem>
          {IMAGE_SIZE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-2">
                {/* 按真实宽高比缩放的矩形边框，直观展示输出形状。 */}
                <span
                  aria-hidden
                  className="shrink-0 rounded-[2px] border border-current"
                  style={{ width: option.box.w, height: option.box.h }}
                />
                <span className="font-mono">{option.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
