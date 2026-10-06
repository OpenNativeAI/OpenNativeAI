/**
 * 多模态设置 — 单模态（图像 / 视频）配置卡片
 * 顶部供应商标题 + 总开关 + ⋯ 菜单（改名称 / 删除供应商）、Base URL、API 格式下拉、
 * API Key（含明文切换 + 获取 API Key 跳转）、模型列表区（标题 + 添加按钮 + 行列表）。
 * 单卡片只承载单个 provider 的配置,provider 切换由外层侧边栏控制。
 */
import type { ReactNode } from "react";
import { EyeIcon, EyeOffIcon, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { MediaStudioProviderView } from "@opennativeai/services";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import {
  MULTIMODAL_API_FORMATS_BY_KIND,
  MULTIMODAL_API_FORMAT_CUSTOM,
} from "@/settings/multimodalDraftState.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";
import {
  MultimodalModelListRow,
  type MultimodalModelEntry,
} from "@/settings/MultimodalModelListRow.js";

export type MultimodalKind = "image" | "video";

/** 图生图协议选项；不暴露给视频模态（视频无 i2i 概念）。 */
const I2I_MODES_IMAGE: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: "edits-multipart", labelKey: "mediaStudio.config.i2iMode.editsMultipart" },
  { value: "image-url-json", labelKey: "mediaStudio.config.i2iMode.imageUrlJson" },
  { value: "input-images-json", labelKey: "mediaStudio.config.i2iMode.inputImagesJson" },
];

export interface MultimodalProviderFormState {
  baseUrl: string;
  apiKey: string;
  apiFormat: string;
  customEndpoint: string;
  /** 仅 image 模态消费；video 模态下也保留字段但会被 UI 隐藏。undefined 等价于使用默认 edits-multipart。 */
  i2iMode?: "edits-multipart" | "image-url-json" | "input-images-json";
  enabled: boolean;
  models: MultimodalModelEntry[];
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-ui-base text-foreground-subtle">{label}</label>
      {children}
    </div>
  );
}

export function MultimodalKindConfigCard({
  kind,
  title,
  icon,
  form,
  saved,
  modelPlaceholder,
  getApiKeyHref,
  onChange,
  onAddModel,
  onModelChange,
  onModelDelete,
  onRenameProvider,
  onDeleteProvider,
}: {
  kind: MultimodalKind;
  title: string;
  icon: ReactNode;
  form: MultimodalProviderFormState;
  saved: MediaStudioProviderView | undefined;
  modelPlaceholder: string;
  getApiKeyHref?: string;
  onChange: (patch: Partial<MultimodalProviderFormState>) => void;
  onAddModel: () => void;
  onModelChange: (modelId: string, patch: Partial<MultimodalModelEntry>) => void;
  onModelDelete: (modelId: string) => void;
  onRenameProvider: () => void;
  onDeleteProvider: () => void;
}) {
  const { intl } = useOpenNativeAIIntl();
  const [keyVisible, setKeyVisible] = useState(false);

  return (
    <SettingsGroupCard>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {icon}
        <span className="flex-1 text-ui-base font-medium text-foreground">{title}</span>
        <Switch
          checked={form.enabled}
          aria-label={intl.formatMessage({
            id:
              kind === "image"
                ? "mediaStudio.config.image.enabled"
                : "mediaStudio.config.video.enabled",
          })}
          onCheckedChange={(checked) => onChange({ enabled: checked })}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={intl.formatMessage({ id: "mediaStudio.config.provider.menu" })}
              title={intl.formatMessage({ id: "mediaStudio.config.provider.menu" })}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={() => onRenameProvider()}>
              <Pencil className="size-3.5" />
              <span>{intl.formatMessage({ id: "mediaStudio.config.provider.rename" })}</span>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => onDeleteProvider()}>
              <Trash2 className="size-3.5" />
              <span>{intl.formatMessage({ id: "mediaStudio.config.provider.delete" })}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="space-y-4 px-4 py-4">
        <FormField label={intl.formatMessage({ id: "mediaStudio.config.baseUrl" })}>
          <Input
            {...TECHNICAL_INPUT_ATTRIBUTES}
            size="lg"
            className="h-9"
            value={form.baseUrl}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
            placeholder="https://open.bigmodel.cn/api/paas/v4"
          />
        </FormField>
        <FormField label={intl.formatMessage({ id: "mediaStudio.config.apiFormat" })}>
          <Select value={form.apiFormat} onValueChange={(value) => onChange({ apiFormat: value })}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue
                placeholder={intl.formatMessage({ id: "mediaStudio.config.apiFormat" })}
              />
            </SelectTrigger>
            <SelectContent>
              {MULTIMODAL_API_FORMATS_BY_KIND[kind].map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {intl.formatMessage({ id: option.labelKey })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        {form.apiFormat === MULTIMODAL_API_FORMAT_CUSTOM ? (
          <FormField
            label={intl.formatMessage({ id: "mediaStudio.config.apiFormat.customEndpoint" })}
          >
            <Input
              {...TECHNICAL_INPUT_ATTRIBUTES}
              size="lg"
              className="h-9"
              value={form.customEndpoint}
              onChange={(event) => onChange({ customEndpoint: event.target.value })}
              placeholder={intl.formatMessage({
                id: "mediaStudio.config.apiFormat.customEndpointPlaceholder",
              })}
            />
          </FormField>
        ) : null}
        {kind === "image" ? (
          <FormField label={intl.formatMessage({ id: "mediaStudio.config.i2iMode.label" })}>
            <Select
              value={form.i2iMode ?? "edits-multipart"}
              onValueChange={(value) =>
                onChange({
                  i2iMode: value as NonNullable<MultimodalProviderFormState["i2iMode"]>,
                })
              }
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue
                  placeholder={intl.formatMessage({ id: "mediaStudio.config.i2iMode.label" })}
                />
              </SelectTrigger>
              <SelectContent>
                {I2I_MODES_IMAGE.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {intl.formatMessage({ id: option.labelKey })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-ui-xs text-foreground-subtle">
              {intl.formatMessage({ id: "mediaStudio.config.i2iMode.hint" })}
            </p>
          </FormField>
        ) : null}
        <FormField label={intl.formatMessage({ id: "mediaStudio.config.apiKey" })}>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                {...TECHNICAL_INPUT_ATTRIBUTES}
                type={keyVisible ? "text" : "password"}
                size="lg"
                className="h-9 pr-10"
                value={form.apiKey}
                onChange={(event) => onChange({ apiKey: event.target.value })}
                placeholder={
                  saved?.hasApiKey
                    ? saved.apiKeyMasked
                    : intl.formatMessage({ id: "mediaStudio.config.apiKeyPlaceholder" })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-1/2 right-1.5 -translate-y-1/2"
                onClick={() => setKeyVisible((visible) => !visible)}
              >
                {keyVisible ? (
                  <EyeOffIcon className="size-3.5" />
                ) : (
                  <EyeIcon className="size-3.5" />
                )}
              </Button>
            </div>
            {getApiKeyHref ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-9 px-2 text-foreground-subtle hover:text-foreground"
                onClick={() => {
                  if (typeof window === "undefined") return;
                  window.open(getApiKeyHref, "_blank", "noopener,noreferrer");
                }}
              >
                {intl.formatMessage({ id: "mediaStudio.config.getApiKey" })}
              </Button>
            ) : null}
          </div>
        </FormField>
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-3">
        <span className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "mediaStudio.config.modelList" })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-ui-base"
          onClick={onAddModel}
        >
          <Plus className="size-3.5" />
          {intl.formatMessage({ id: "mediaStudio.config.addModel" })}
        </Button>
      </div>
      {form.models.length > 0 ? (
        <div className="border-t border-input-border bg-input">
          {form.models.map((model, index) => (
            <MultimodalModelListRow
              key={model.id}
              model={model}
              index={index}
              isLast={index === form.models.length - 1}
              onChange={(patch) => onModelChange(model.id, patch)}
              onDelete={() => onModelDelete(model.id)}
            />
          ))}
        </div>
      ) : (
        <div className="border-t border-input-border bg-input px-4 py-6 text-center text-ui-base text-foreground-subtle">
          {intl.formatMessage(
            { id: "mediaStudio.config.modelListEmpty" },
            { placeholder: modelPlaceholder },
          )}
        </div>
      )}
    </SettingsGroupCard>
  );
}
