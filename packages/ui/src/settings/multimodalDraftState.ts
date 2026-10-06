/**
 * 多模态设置 — 草稿与持久化辅助函数
 * 把 ProviderFormState / KindState 的构建与折叠逻辑集中在这里,便于主组件保持薄。
 * 初始仅提供一个「默认供应商」条目,不在数据层写入任何具体供应商名称,
 * 避免与用户自己命名的供应商产生冲突;名称由用户在侧栏双击就地编辑。
 * apiFormat / customEndpoint / tags 仅本地 state,不写入 IMediaStudioService,
 * 刷新页面后归零,后续接 listModels / provider preset 时再考虑是否需要持久化。
 */
import type { MediaStudioProviderView } from "@opennativeai/services";
import type { MultimodalKind } from "@/settings/MultimodalKindConfigCard.js";
import type { MultimodalModelEntry } from "@/settings/MultimodalModelListRow.js";

export interface ProviderFormState {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  /** UI-only:API 格式选择(Chat Completions / Image Generations / Custom / ...)。 */
  apiFormat: string;
  /** UI-only:当 apiFormat 为 "custom" 时由用户填写的端点路径或模板。 */
  customEndpoint: string;
  /** 图生图参考图上传协议；不同中转站 / 模型对协议差异较大，提供切换兜底。
   *  - edits-multipart：OpenAI / Azure gpt-image 系标准，`POST /images/edits` + multipart
   *  - image-url-json：`POST /images/generations` + JSON `image_url` 字段
   *  - input-images-json：Qwen 风格，`POST /images/generations` + JSON `input_images` 字段
   *  不填则默认 edits-multipart。 */
  i2iMode?: "edits-multipart" | "image-url-json" | "input-images-json";
  enabled: boolean;
  models: MultimodalModelEntry[];
}

export interface KindState {
  providers: ProviderFormState[];
  activeProviderId: string;
}

export const MULTIMODAL_API_FORMAT_CUSTOM = "custom";

/**
 * 视频 / 图片各持一份格式列表,差异点:
 * - 视频有 `video-generations`,没有 `image-generations`;
 * - 图片有 `image-generations`,没有 `video-generations`;
 * - 两边都保留 chat-completions / responses / custom 作为通用入口。
 * 真实接入生成请求时由调用方按 apiFormat 派发到对应解析器。
 */
export const MULTIMODAL_API_FORMATS_BY_KIND: Record<
  MultimodalKind,
  ReadonlyArray<{ value: string; labelKey: string }>
> = {
  image: [
    { value: "image-generations", labelKey: "mediaStudio.config.apiFormat.imageGenerations" },
    { value: "chat-completions", labelKey: "mediaStudio.config.apiFormat.chatCompletions" },
    { value: "responses", labelKey: "mediaStudio.config.apiFormat.responses" },
    {
      value: "anthropic-messages",
      labelKey: "mediaStudio.config.apiFormat.anthropicMessages",
    },
    { value: MULTIMODAL_API_FORMAT_CUSTOM, labelKey: "mediaStudio.config.apiFormat.custom" },
  ],
  video: [
    { value: "video-generations", labelKey: "mediaStudio.config.apiFormat.videoGenerations" },
    { value: "chat-completions", labelKey: "mediaStudio.config.apiFormat.chatCompletions" },
    { value: "responses", labelKey: "mediaStudio.config.apiFormat.responses" },
    {
      value: "anthropic-messages",
      labelKey: "mediaStudio.config.apiFormat.anthropicMessages",
    },
    { value: MULTIMODAL_API_FORMAT_CUSTOM, labelKey: "mediaStudio.config.apiFormat.custom" },
  ],
};

export function makeCustomProvider(
  label = "默认供应商",
  kind: MultimodalKind = "image",
): ProviderFormState {
  const formats = MULTIMODAL_API_FORMATS_BY_KIND[kind];
  const defaultFormat = formats[0]?.value ?? "chat-completions";
  return {
    id: `custom-${Date.now().toString(36)}`,
    label,
    baseUrl: "",
    apiKey: "",
    apiFormat: defaultFormat,
    customEndpoint: "",
    i2iMode: "edits-multipart",
    enabled: true,
    models: [],
  };
}

export function nextModelId(existing: readonly MultimodalModelEntry[]): string {
  // 模型 id 仅用于本地 React key / 拖拽 / 编辑定位,使用单调递增避免与历史值冲突。
  const used = new Set(existing.map((entry) => entry.id));
  let counter = existing.length + 1;
  while (used.has(`model-${counter}`)) counter += 1;
  return `model-${counter}`;
}

export function providerHasInput(provider: ProviderFormState): boolean {
  return Boolean(
    provider.baseUrl.trim() ||
    provider.apiKey.trim() ||
    provider.models.some((model) => model.name.trim()),
  );
}

export function modelsFromProviderView(
  view: MediaStudioProviderView | undefined,
): MultimodalModelEntry[] {
  if (!view) return [];
  // 修复：新协议下 view.models 数组是事实源，之前只读 view.model（=models[0]）
  // 导致已保存的第二个及以后的模型不回显。
  // 旧 Host/旧配置回退：无数组时仍按单 model 字段逗号拆分，避免历史合并写法被吞。
  const source = view.models.length > 0 ? view.models : view.model.split(",");
  return source
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name, index) => ({
      id: index === 0 ? "model-1" : `model-${index + 1}`,
      name,
      enabled: true,
    }));
}

// 把本地 providers 折叠回 IMediaStudioService 协议字段。
// - models: 启用的非空模型 ID 数组(下拉直接消费此字段);
// - model : 同步 models[0],保留旧字段给旧 Host/迁移路径用。
// 已禁用模型不计入提交,空名行同步丢弃,避免空白污染远端配置。
export function collapseModelField(provider: ProviderFormState): {
  models: string[];
  model: string;
} {
  const models = provider.models
    .filter((entry) => entry.enabled && entry.name.trim())
    .map((entry) => entry.name.trim());
  return { models, model: models[0] ?? "" };
}

export function makeEmptyKindState(): KindState {
  // 初次进入:仅放一个「默认供应商」空条目,默认选中;
  // 不写入具体供应商名称,避免和用户即将填写的 baseUrl 来自的供应商产生错位。
  const defaultProvider = makeCustomProvider();
  return {
    providers: [defaultProvider],
    activeProviderId: defaultProvider.id,
  };
}

export function renameProvider(state: KindState, providerId: string, label: string): KindState {
  const trimmed = label.trim();
  if (!trimmed) return state;
  return {
    ...state,
    providers: state.providers.map((provider) =>
      provider.id === providerId ? { ...provider, label: trimmed } : provider,
    ),
  };
}

// 删除指定 provider:若删除后还有剩余 provider,把激活位回退到第一位;
// 若列表已空则保留空状态由调用方决定后续动作(提示 / 自动新建 等)。
export function deleteProvider(state: KindState, providerId: string): KindState {
  const nextProviders = state.providers.filter((provider) => provider.id !== providerId);
  if (nextProviders.length === state.providers.length) return state;
  const nextActiveId =
    state.activeProviderId === providerId ? (nextProviders[0]?.id ?? "") : state.activeProviderId;
  return {
    providers: nextProviders,
    activeProviderId: nextActiveId,
  };
}

export function clearApiKeysInActive(state: KindState): KindState {
  return {
    ...state,
    providers: state.providers.map((provider) =>
      provider.id === state.activeProviderId ? { ...provider, apiKey: "" } : provider,
    ),
  };
}

export function applyHydratedConfig(
  setter: (next: KindState | ((prev: KindState) => KindState)) => void,
  view: MediaStudioProviderView,
): void {
  setter((prev) => {
    // 协议层只持久化单一 provider,回填时把已存数据写入当前活跃 provider;
    // 其他 provider 保持空状态,避免覆盖用户在 UI 中已编辑的草稿。
    // 已存 baseUrl 提示已配置,但不在数据层自动命名 — 命名由用户在侧栏决定。
    return {
      ...prev,
      providers: prev.providers.map((provider) =>
        provider.id === prev.activeProviderId
          ? {
              ...provider,
              baseUrl: view.baseUrl,
              apiKey: "",
              apiFormat: provider.apiFormat,
              customEndpoint: provider.customEndpoint,
              // i2iMode 优先用 view 回传的已存值；空值时保持现有草稿（默认 edits-multipart）。
              i2iMode: view.i2iMode ?? provider.i2iMode ?? "edits-multipart",
              enabled: provider.enabled,
              models: modelsFromProviderView(view),
            }
          : provider,
      ),
    };
  });
}

export function resolveGetApiKeyHref(baseUrl: string | undefined): string | undefined {
  // 供应商域名不可信时不开新标签页,避免误导用户;否则直接定位到对应控制台。
  const url = baseUrl?.trim() ?? "";
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "open.bigmodel.cn") return "https://open.bigmodel.cn/user-center/apikeys";
    if (host.endsWith(".aliyuncs.com") || host === "dashscope.console.aliyun.com") {
      return "https://dashscope.console.aliyun.com/apiKey";
    }
    return undefined;
  } catch {
    return undefined;
  }
}
