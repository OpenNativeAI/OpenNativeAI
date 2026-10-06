/**
 * Media Studio 配置的读写原语 —— 按模态独立的 config.json（600）存取与视图转换。
 * 从 mediaStudioService 拆出：服务本体专注任务生命周期，这里只管配置事实源。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type {
  MediaStudioJobKind,
  MediaStudioProviderConfig,
  MediaStudioProviderView,
} from "./mediaStudio.js";
import type { MediaStudioPaths } from "./mediaStudioLayout.js";

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return "****";
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;
}

/** 一个模态的 provider 可用 = baseUrl 与 apiKey 齐全；models 在提交时单独校验。 */
export function isProviderUsable(provider: MediaStudioProviderConfig): boolean {
  return Boolean(provider.baseUrl && provider.apiKey);
}

export async function readProviderConfig(
  paths: MediaStudioPaths,
  kind: MediaStudioJobKind,
): Promise<MediaStudioProviderConfig | null> {
  try {
    const raw = await readFile(paths.kinds[kind].configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<MediaStudioProviderConfig>;
    const baseUrl = String(parsed.baseUrl ?? "").trim();
    const apiKey = String(parsed.apiKey ?? "").trim();
    // 新布局：models 数组优先；旧布局：只有 model 字段，把它当作单元素数组回填。
    const fromArray = Array.isArray(parsed.models)
      ? (parsed.models as unknown[])
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [];
    const legacyModel = typeof parsed.model === "string" ? parsed.model.trim() : "";
    const models = fromArray.length > 0 ? fromArray : legacyModel ? [legacyModel] : [];
    const provider: MediaStudioProviderConfig = {
      baseUrl,
      apiKey,
      models,
      // 旧字段同步回 model，方便外部读 config 时直接拿到一个默认值。
      model: models[0] ?? legacyModel ?? "",
      ...(parsed.i2iMode &&
      (parsed.i2iMode === "edits-multipart" ||
        parsed.i2iMode === "image-url-json" ||
        parsed.i2iMode === "input-images-json")
        ? { i2iMode: parsed.i2iMode }
        : {}),
    };
    return isProviderUsable(provider) ? provider : null;
  } catch {
    return null;
  }
}

export async function writeProviderConfig(
  paths: MediaStudioPaths,
  kind: MediaStudioJobKind,
  provider: MediaStudioProviderConfig,
): Promise<void> {
  await mkdir(paths.kinds[kind].rootDir, { recursive: true });
  await writeFile(paths.kinds[kind].configPath, JSON.stringify(provider, null, 2), {
    mode: 0o600,
  });
}

const EMPTY_VIEW: MediaStudioProviderView = {
  baseUrl: "",
  model: "",
  models: [],
  apiKeyMasked: "",
  hasApiKey: false,
};

/** getConfig 回显视图：不回传 apiKey 明文，仅掩码；未配置的模态给空视图。 */
export function toProviderView(
  provider: MediaStudioProviderConfig | null,
): MediaStudioProviderView {
  if (!provider) return EMPTY_VIEW;
  return {
    baseUrl: provider.baseUrl,
    model: provider.model ?? "",
    models: provider.models,
    apiKeyMasked: maskApiKey(provider.apiKey),
    hasApiKey: true,
    i2iMode: provider.i2iMode,
  };
}
