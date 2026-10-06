/**
 * 多模态设置 — 左侧供应商侧边栏
 * 仿照模型设置:每个条目显示图标 + 名称 + 状态指示,选中条目高亮。
 * 重命名:双击条目名称或在卡片头 ⋯ 菜单里选「编辑名称」,进入就地编辑,
 * 由外部通过 renamingProviderId 控制激活哪个条目;Enter / blur 提交,Escape 取消。
 * 不预设任何具体供应商,默认条目由调用方提供一个干净的名称。
 */
import { useState } from "react";
import { Image as ImageIcon, Plus } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";
import type { MultimodalKind } from "@/settings/MultimodalKindConfigCard.js";

export interface MultimodalProviderDraft {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  /** 真实配置是否已填,用于在状态指示中区分空 / 异常 / 就绪。 */
  hasConfig: boolean;
}

export interface MultimodalProviderSidebarProps {
  kind: MultimodalKind;
  providers: readonly MultimodalProviderDraft[];
  activeProviderId: string;
  renamingProviderId: string | null;
  onSelectProvider: (providerId: string) => void;
  onRenameProvider: (providerId: string, label: string) => void;
  onRenamingProviderChange: (providerId: string | null) => void;
  onAddProvider: () => void;
}

export function MultimodalProviderSidebar({
  kind,
  providers,
  activeProviderId,
  renamingProviderId,
  onSelectProvider,
  onRenameProvider,
  onRenamingProviderChange,
  onAddProvider,
}: MultimodalProviderSidebarProps) {
  const { intl } = useOpenNativeAIIntl();
  return (
    <div className="flex w-56 shrink-0 flex-col gap-1.5">
      <button
        type="button"
        onClick={onAddProvider}
        className="flex h-8 items-center gap-2 rounded-lg border border-dashed border-border px-2 py-1 text-left text-ui-base font-medium text-foreground-subtle transition-colors hover:border-border-hover hover:bg-card hover:text-foreground"
      >
        <Plus className="size-3.5" />
        <span className="truncate">
          {intl.formatMessage({ id: "mediaStudio.config.provider.new" })}
        </span>
      </button>
      <div role="listbox" aria-label={`${kind} 供应商`} className="flex flex-col gap-1">
        {providers.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            isSelected={provider.id === activeProviderId}
            isRenaming={provider.id === renamingProviderId}
            onSelect={onSelectProvider}
            onRename={onRenameProvider}
            onRenamingChange={onRenamingProviderChange}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderRow({
  provider,
  isSelected,
  isRenaming,
  onSelect,
  onRename,
  onRenamingChange,
}: {
  provider: MultimodalProviderDraft;
  isSelected: boolean;
  isRenaming: boolean;
  onSelect: (providerId: string) => void;
  onRename: (providerId: string, label: string) => void;
  onRenamingChange: (providerId: string | null) => void;
}) {
  const { intl } = useOpenNativeAIIntl();
  const [draft, setDraft] = useState(provider.label);

  const status = !provider.enabled ? "disabled" : provider.hasConfig ? "ready" : "empty";

  const startRenaming = () => {
    setDraft(provider.label);
    onRenamingChange(provider.id);
  };

  const commit = () => {
    const next = draft.trim();
    // 空名视为放弃编辑,保留原值避免误删条目。
    if (next && next !== provider.label) onRename(provider.id, next);
    else setDraft(provider.label);
    onRenamingChange(null);
  };

  const cancel = () => {
    setDraft(provider.label);
    onRenamingChange(null);
  };

  return (
    <div
      role="option"
      aria-selected={isSelected}
      data-state={isSelected ? "selected" : "idle"}
      className={cn(
        "relative box-border flex h-8 w-full items-center gap-2 rounded-lg border px-2 py-1 text-left text-ui-base font-medium transition-colors",
        isSelected
          ? "border-border-hover bg-card-selected text-foreground"
          : "border-transparent text-foreground hover:border-border-hover/60 hover:bg-card",
      )}
    >
      <ImageIcon className="size-4 shrink-0 text-foreground-subtle" />
      {isRenaming ? (
        <input
          autoFocus
          className="min-w-0 flex-1 rounded border border-border bg-transparent px-1 text-ui-base font-medium text-foreground outline-none focus:border-foreground"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          aria-label={intl.formatMessage({ id: "mediaStudio.config.provider.rename" })}
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <button
          type="button"
          onClick={() => onSelect(provider.id)}
          onDoubleClick={(event) => {
            event.preventDefault();
            startRenaming();
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5"
          title={intl.formatMessage({ id: "mediaStudio.config.provider.renameHint" })}
        >
          <span className="min-w-0 truncate">{provider.label}</span>
        </button>
      )}
      <ProviderStatusDot status={status} />
    </div>
  );
}

function ProviderStatusDot({ status }: { status: "ready" | "empty" | "disabled" }) {
  const { intl } = useOpenNativeAIIntl();
  const color =
    status === "ready"
      ? "bg-success"
      : status === "empty"
        ? "bg-warning"
        : "bg-foreground-subtlest";
  const label =
    status === "ready"
      ? intl.formatMessage({ id: "mediaStudio.config.provider.statusReady" })
      : status === "empty"
        ? intl.formatMessage({ id: "mediaStudio.config.provider.statusEmpty" })
        : intl.formatMessage({ id: "mediaStudio.config.provider.statusDisabled" });
  return (
    <span
      aria-hidden="true"
      className={cn("size-1.5 shrink-0 rounded-full", color)}
      title={label}
    />
  );
}
