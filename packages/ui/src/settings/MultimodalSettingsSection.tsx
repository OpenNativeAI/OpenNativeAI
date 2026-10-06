/**
 * 设置页「多模态」分区 —— Media Studio 供应商配置的唯一读写入口。
 * UI 仿照模型设置:左侧供应商侧栏 + 右侧详情卡(Base URL / API Key / 模型列表)。
 * 供应商列表为本地 state,允许手动增删启用;保存时取当前模态的活跃供应商
 * 折叠成单字段回写 IMediaStudioService,与现有协议保持兼容。
 * 多模态存储目录（~/.opennativeai/media-studio）展示与打开保留在末尾。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image as ImageIcon, Loader2, RefreshCw, Video as VideoIcon } from "lucide-react";
import type { IMediaStudioService, MediaStudioProviderView } from "@opennativeai/services";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  MultimodalKindConfigCard,
  type MultimodalKind,
} from "@/settings/MultimodalKindConfigCard.js";
import type { MultimodalModelEntry } from "@/settings/MultimodalModelListRow.js";
import {
  MultimodalProviderSidebar,
  type MultimodalProviderDraft,
} from "@/settings/MultimodalProviderSidebar.js";
import { SegmentPill } from "@/settings/PluginStoreListView.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import {
  applyHydratedConfig,
  clearApiKeysInActive,
  collapseModelField,
  deleteProvider as deleteProviderInState,
  makeCustomProvider,
  makeEmptyKindState,
  nextModelId,
  providerHasInput,
  renameProvider,
  resolveGetApiKeyHref,
  type KindState,
  type ProviderFormState,
} from "@/settings/multimodalDraftState.js";

type SavedConfig = Awaited<ReturnType<IMediaStudioService["getConfig"]>>;

type MultimodalTab = MultimodalKind | "general";

const TAB_KEYS: ReadonlyArray<{ id: MultimodalTab; intlKey: string; testId: string }> = [
  { id: "image", intlKey: "mediaStudio.config.tab.image", testId: "multimodal-tab-image" },
  { id: "video", intlKey: "mediaStudio.config.tab.video", testId: "multimodal-tab-video" },
  {
    id: "general",
    intlKey: "mediaStudio.config.tab.general",
    testId: "multimodal-tab-general",
  },
];

function toProviderDraft(provider: ProviderFormState): MultimodalProviderDraft {
  return {
    id: provider.id,
    label: provider.label,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    enabled: provider.enabled,
    hasConfig: providerHasInput(provider),
  };
}

async function handleRefreshPlaceholder(): Promise<void> {
  // 占位:目前没有刷新元数据接口,按钮保留以便未来接入供应商列表拉取。
}

export function MultimodalSettingsSection({
  mediaStudioService,
}: {
  mediaStudioService: IMediaStudioService | undefined;
}) {
  const { intl } = useOpenNativeAIIntl();
  const platform = usePlatform();

  const [saved, setSaved] = useState<SavedConfig>(null);
  const [storageRoot, setStorageRoot] = useState<string | null>(null);
  const [image, setImage] = useState<KindState>(() => makeEmptyKindState());
  const [video, setVideo] = useState<KindState>(() => makeEmptyKindState());
  const [saving, setSaving] = useState(false);
  // 图片模型 / 视频模型 / 常规配置 三个分类;通用项(存储路径等)放常规 tab。
  const [activeTab, setActiveTab] = useState<MultimodalTab>("image");
  // 侧栏就地重命名控制:仅记录当前正在重命名的 providerId,
  // 由 MultimodalProviderSidebar 通过受控 prop 决定哪一行渲染为 input。
  const [renamingProviderId, setRenamingProviderId] = useState<string | null>(null);

  useEffect(() => {
    if (!mediaStudioService) return;
    let disposed = false;
    void (async () => {
      // 配置与存储路径分开加载:旧 Host 缺 getStorageRoot 时只隐藏路径行,
      // 不能连带让 Promise.all 整体 reject 把配置表单也清空。
      try {
        const savedConfig = await mediaStudioService.getConfig();
        if (disposed) return;
        setSaved(savedConfig);
        if (savedConfig) {
          // apiKey 不回传明文,草稿留空、以掩码占位;保存时空串由服务侧保留旧 key。
          applyHydratedConfig(setImage, savedConfig.image);
          applyHydratedConfig(setVideo, savedConfig.video);
        }
      } catch (error) {
        logger.warn("[media-studio] 设置页读取配置失败", { error });
      }
      try {
        const root = await mediaStudioService.getStorageRoot();
        if (!disposed) setStorageRoot(root);
      } catch (error) {
        logger.warn(
          "[media-studio] 读取多模态存储目录失败(可能是旧 Host 构建缺 getStorageRoot,需重启 pnpm dev)",
          { error },
        );
      }
    })();
    return () => {
      disposed = true;
    };
  }, [mediaStudioService]);

  // 当前选中的模态(图片 / 视频);常规 tab 下为 null,详情卡与侧栏都不渲染。
  const activeKind: MultimodalKind | null = activeTab === "general" ? null : activeTab;
  const activeState = activeKind === null ? null : activeKind === "image" ? image : video;
  const activeSavedView =
    activeKind === null ? undefined : activeKind === "image" ? saved?.image : saved?.video;
  const activeModelPlaceholder =
    activeKind === "image" ? "cogview-4" : activeKind === "video" ? "cogvideox-2" : "";
  const activeProvider =
    activeState === null
      ? undefined
      : (activeState.providers.find((provider) => provider.id === activeState.activeProviderId) ??
        activeState.providers[0]);

  const applyPatch = useCallback((kind: MultimodalKind, patch: Partial<ProviderFormState>) => {
    const setter = kind === "image" ? setImage : setVideo;
    setter((prev) => ({
      ...prev,
      providers: prev.providers.map((provider) =>
        provider.id === prev.activeProviderId ? { ...provider, ...patch } : provider,
      ),
    }));
  }, []);

  const addModel = useCallback((kind: MultimodalKind) => {
    const setter = kind === "image" ? setImage : setVideo;
    setter((prev) => ({
      ...prev,
      providers: prev.providers.map((provider) =>
        provider.id === prev.activeProviderId
          ? {
              ...provider,
              models: [
                ...provider.models,
                { id: nextModelId(provider.models), name: "", enabled: true },
              ],
            }
          : provider,
      ),
    }));
  }, []);

  const updateModel = useCallback(
    (kind: MultimodalKind, modelId: string, patch: Partial<MultimodalModelEntry>) => {
      const setter = kind === "image" ? setImage : setVideo;
      setter((prev) => ({
        ...prev,
        providers: prev.providers.map((provider) =>
          provider.id === prev.activeProviderId
            ? {
                ...provider,
                models: provider.models.map((model) =>
                  model.id === modelId ? { ...model, ...patch } : model,
                ),
              }
            : provider,
        ),
      }));
    },
    [],
  );

  const deleteModel = useCallback((kind: MultimodalKind, modelId: string) => {
    const setter = kind === "image" ? setImage : setVideo;
    setter((prev) => ({
      ...prev,
      providers: prev.providers.map((provider) =>
        provider.id === prev.activeProviderId
          ? { ...provider, models: provider.models.filter((model) => model.id !== modelId) }
          : provider,
      ),
    }));
  }, []);

  const selectProvider = useCallback((kind: MultimodalKind, providerId: string) => {
    const setter = kind === "image" ? setImage : setVideo;
    setter((prev) => ({ ...prev, activeProviderId: providerId }));
  }, []);

  const addProvider = useCallback((kind: MultimodalKind) => {
    const setter = kind === "image" ? setImage : setVideo;
    setter((prev) => {
      const created = makeCustomProvider();
      return {
        ...prev,
        providers: [...prev.providers, created],
        activeProviderId: created.id,
      };
    });
  }, []);

  const renameActiveProvider = useCallback(
    (kind: MultimodalKind, providerId: string, label: string) => {
      const setter = kind === "image" ? setImage : setVideo;
      setter((prev) => renameProvider(prev, providerId, label));
    },
    [],
  );

  // 卡片头 ⋯ 菜单里的「重命名」:复用侧栏的就地编辑体验,
  // 通过 setting renamingProviderId 让侧栏对应行切到 input。
  const beginRenameActiveProvider = useCallback((kind: MultimodalKind) => {
    const setter = kind === "image" ? setImage : setVideo;
    setter((prev) => {
      setRenamingProviderId(prev.activeProviderId);
      return prev;
    });
  }, []);

  const deleteActiveProvider = useCallback((kind: MultimodalKind, providerId: string) => {
    const setter = kind === "image" ? setImage : setVideo;
    setter((prev) => deleteProviderInState(prev, providerId));
    // 同步清掉可能存在的就地重命名态,避免 input 指向已删条目。
    setRenamingProviderId((current) => (current === providerId ? null : current));
  }, []);

  const handleSave = useCallback(async () => {
    if (!mediaStudioService) return;
    const draftValid = (provider: ProviderFormState, view: MediaStudioProviderView | undefined) =>
      !providerHasInput(provider) ||
      Boolean(
        provider.baseUrl.trim() &&
        (provider.apiKey.trim() || view?.hasApiKey) &&
        (provider.models.some((entry) => entry.name.trim()) || (view?.models.length ?? 0) > 0),
      );
    const anyInput =
      image.providers.some((provider) => providerHasInput(provider)) ||
      video.providers.some((provider) => providerHasInput(provider));
    const incomplete =
      !anyInput ||
      !image.providers.every((provider) => draftValid(provider, saved?.image)) ||
      !video.providers.every((provider) => draftValid(provider, saved?.video));
    if (incomplete) {
      toast(intl.formatMessage({ id: "mediaStudio.config.incomplete" }), { variant: "warning" });
      return;
    }
    setSaving(true);
    try {
      // 仅持久化当前活跃 provider 的配置;非活跃 provider 仅保留在 UI 会话内,
      // 避免引入超出当前协议的多供应商持久化语义。
      const imageActive = image.providers.find(
        (provider) => provider.id === image.activeProviderId,
      );
      const videoActive = video.providers.find(
        (provider) => provider.id === video.activeProviderId,
      );
      await mediaStudioService.saveConfig({
        image: {
          baseUrl: imageActive?.baseUrl.trim() ?? "",
          apiKey: imageActive?.apiKey.trim() ?? "",
          ...(imageActive ? collapseModelField(imageActive) : { models: [], model: "" }),
          // 仅当 i2iMode 是已知合法值才下发;空串等价于使用默认 edits-multipart,
          // 让服务端可以选择不回写该字段（保持旧配置）。
          ...(imageActive &&
          (imageActive.i2iMode === "edits-multipart" ||
            imageActive.i2iMode === "image-url-json" ||
            imageActive.i2iMode === "input-images-json")
            ? { i2iMode: imageActive.i2iMode }
            : {}),
        },
        video: {
          baseUrl: videoActive?.baseUrl.trim() ?? "",
          apiKey: videoActive?.apiKey.trim() ?? "",
          ...(videoActive ? collapseModelField(videoActive) : { models: [], model: "" }),
        },
      });
      const next = await mediaStudioService.getConfig();
      setSaved(next);
      // 清空两个 active provider 的 apiKey 草稿(由服务侧掩码回显),其余字段保留。
      setImage((prev) => clearApiKeysInActive(prev));
      setVideo((prev) => clearApiKeysInActive(prev));
      toast(intl.formatMessage({ id: "mediaStudio.config.saved" }), { variant: "info" });
    } catch (error) {
      logger.error("[media-studio] 保存配置失败", { error });
      toast(intl.formatMessage({ id: "mediaStudio.config.saveFailed" }), { variant: "warning" });
    } finally {
      setSaving(false);
    }
  }, [image, intl, mediaStudioService, saved, video]);

  const handleOpenStorageRoot = useCallback(async () => {
    if (!storageRoot) return;
    const result = await platform.openInFileManager(storageRoot);
    if (!result.success) {
      toast(intl.formatMessage({ id: "appHeader.openInFileManagerFailed" }));
    }
  }, [intl, platform, storageRoot]);

  const getApiKeyHref = useMemo(
    () => resolveGetApiKeyHref(activeProvider?.baseUrl),
    [activeProvider?.baseUrl],
  );

  if (!mediaStudioService) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-transparent px-4 py-8 text-center text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "mediaStudio.unavailable" })}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.multimodal.description" })}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={intl.formatMessage({ id: "settings.multimodal.refresh" })}
            title={intl.formatMessage({ id: "settings.multimodal.refresh" })}
            onClick={() => void handleRefreshPlaceholder()}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>
      <div
        role="tablist"
        aria-label={intl.formatMessage({ id: "settings.multimodal.title" })}
        className="flex items-center gap-1.5"
      >
        {TAB_KEYS.map((tab) => (
          <SegmentPill
            key={tab.id}
            active={activeTab === tab.id}
            label={intl.formatMessage({ id: tab.intlKey })}
            testId={tab.testId}
            onClick={() => setActiveTab(tab.id)}
          />
        ))}
      </div>
      {activeKind === null ? (
        <SettingsGroupCard>
          <SettingsRow
            label={intl.formatMessage({ id: "settings.multimodal.storage.label" })}
            description={intl.formatMessage({ id: "settings.multimodal.storage.description" })}
            control={null}
            detail={
              storageRoot ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  aria-label={intl.formatMessage({ id: "settings.multimodal.storage.label" })}
                  title={storageRoot}
                  className="inline-flex h-auto max-w-full items-baseline gap-1.5 whitespace-normal break-all px-0 py-0 text-left align-baseline font-mono text-ui-base font-normal text-foreground-subtle underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => void handleOpenStorageRoot()}
                >
                  <span>{storageRoot}</span>
                </Button>
              ) : null
            }
          />
        </SettingsGroupCard>
      ) : (
        <>
          <div className="flex gap-4">
            <MultimodalProviderSidebar
              kind={activeKind}
              providers={activeState?.providers.map(toProviderDraft) ?? []}
              activeProviderId={activeState?.activeProviderId ?? ""}
              renamingProviderId={renamingProviderId}
              onSelectProvider={(providerId) => selectProvider(activeKind, providerId)}
              onRenameProvider={(providerId, label) =>
                renameActiveProvider(activeKind, providerId, label)
              }
              onRenamingProviderChange={setRenamingProviderId}
              onAddProvider={() => addProvider(activeKind)}
            />
            <div className="flex-1 min-w-0">
              {activeProvider && activeState ? (
                <MultimodalKindConfigCard
                  kind={activeKind}
                  title={intl.formatMessage({
                    id:
                      activeKind === "image"
                        ? "mediaStudio.config.image.title"
                        : "mediaStudio.config.video.title",
                  })}
                  icon={
                    activeKind === "image" ? (
                      <ImageIcon className="size-4 text-foreground-subtle" />
                    ) : (
                      <VideoIcon className="size-4 text-foreground-subtle" />
                    )
                  }
                  form={{
                    baseUrl: activeProvider.baseUrl,
                    apiKey: activeProvider.apiKey,
                    apiFormat: activeProvider.apiFormat,
                    customEndpoint: activeProvider.customEndpoint,
                    i2iMode: activeProvider.i2iMode ?? "edits-multipart",
                    enabled: activeProvider.enabled,
                    models: activeProvider.models,
                  }}
                  saved={activeSavedView}
                  modelPlaceholder={activeModelPlaceholder}
                  getApiKeyHref={getApiKeyHref}
                  onChange={(patch) => applyPatch(activeKind, patch)}
                  onAddModel={() => addModel(activeKind)}
                  onModelChange={(modelId, patch) => updateModel(activeKind, modelId, patch)}
                  onModelDelete={(modelId) => deleteModel(activeKind, modelId)}
                  onRenameProvider={() => beginRenameActiveProvider(activeKind)}
                  onDeleteProvider={() => deleteActiveProvider(activeKind, activeProvider.id)}
                />
              ) : null}
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {intl.formatMessage({ id: "mediaStudio.config.save" })}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
