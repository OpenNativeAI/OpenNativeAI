import type { LocalEngineModelInfo } from "@opennativeai/shared";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";

/** 字节数转人读单位（1024 进制）；无值或非正数返回 null 以隐藏该行。 */
function formatBytes(bytes?: number): string | null {
  if (bytes === undefined || bytes <= 0) {
    return null;
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 || value >= 100 ? 0 : 1)} ${units[index]}`;
}

/** 参数量转 B/M/K 计数单位；无值或非正数返回 null。 */
function formatParamCount(count?: number): string | null {
  if (count === undefined || count <= 0) {
    return null;
  }
  if (count >= 1e9) {
    return `${(count / 1e9).toFixed(1)}B`;
  }
  if (count >= 1e6) {
    return `${(count / 1e6).toFixed(1)}M`;
  }
  if (count >= 1e3) {
    return `${(count / 1e3).toFixed(1)}K`;
  }
  return String(count);
}

/** 数字转本地化字符串；undefined 返回 null 以隐藏该行。 */
function formatNumber(value?: number): string | null {
  return value === undefined ? null : value.toLocaleString();
}

/**
 * 引擎运行时/模型详情卡片（只读）。
 * 数据全部来自 Host 下发的 status.info（node-llama-cpp 即时采集），Renderer 不缓存、不改写；
 * 取不到的字段自动省略，不展示占位假值。内存/线程等运行时值由上层按间隔刷新，本组件只做渲染。
 */
export function EngineInfoCard({
  info,
  baseUrl,
}: {
  info: LocalEngineModelInfo;
  baseUrl?: string;
}) {
  const { intl } = useOpenNativeAIIntl();
  const entries: Array<{ id: string; value: string }> = [];
  const push = (id: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined && value !== "") {
      entries.push({ id, value });
    }
  };
  const boolText = (value: boolean | undefined): string | null =>
    value === undefined
      ? null
      : intl.formatMessage({
          id: value ? "settings.textEngine.info.yes" : "settings.textEngine.info.no",
        });
  // mmap 加载语义特殊：true=按需内存映射，false=一次性全量读入物理内存，用专用文案而非是/否。
  const mmapText = (value: boolean | undefined): string | null =>
    value === undefined
      ? null
      : intl.formatMessage({
          id: value
            ? "settings.textEngine.info.mmapOnDemand"
            : "settings.textEngine.info.mmapFullResident",
        });
  push("settings.textEngine.info.loadedToMemory", boolText(info.loadedToMemory));
  push("settings.textEngine.info.residentLocked", boolText(info.residentLocked));
  push("settings.textEngine.info.usesMmap", mmapText(info.usesMmap));
  push("settings.textEngine.info.gpuActive", boolText(info.gpuActive));
  push("settings.textEngine.info.flashAttention", boolText(info.flashAttention));
  push("settings.textEngine.info.supportedByLlamaCpp", boolText(info.supportedByLlamaCpp));
  push("settings.textEngine.info.modelName", info.displayName);
  push("settings.textEngine.info.fileName", info.modelFileName);
  push("settings.textEngine.info.architecture", info.architecture);
  push("settings.textEngine.info.quantization", info.quantizationType);
  push("settings.textEngine.info.vocabularyType", info.vocabularyType);
  push("settings.textEngine.info.parameters", formatParamCount(info.parameterCount));
  push("settings.textEngine.info.layers", formatNumber(info.totalLayers));
  push("settings.textEngine.info.gpuLayers", formatNumber(info.gpuLayers));
  push("settings.textEngine.info.trainContext", formatNumber(info.trainContextSize));
  push("settings.textEngine.info.contextSize", formatNumber(info.contextSize));
  push("settings.textEngine.info.batchSize", formatNumber(info.batchSize));
  push("settings.textEngine.info.embeddingDim", formatNumber(info.embeddingVectorSize));
  push("settings.textEngine.info.modelSize", formatBytes(info.modelSizeBytes));
  push("settings.textEngine.info.modelRam", formatBytes(info.modelRamUsageBytes));
  push("settings.textEngine.info.modelVram", formatBytes(info.modelVramUsageBytes));
  push("settings.textEngine.info.contextRam", formatBytes(info.contextRamUsageBytes));
  push("settings.textEngine.info.contextVram", formatBytes(info.contextVramUsageBytes));
  push("settings.textEngine.info.ram", formatBytes(info.ramUsageBytes));
  push("settings.textEngine.info.vram", formatBytes(info.vramUsageBytes));
  push("settings.textEngine.info.threads", formatNumber(info.threads));
  push("settings.textEngine.info.idealThreads", formatNumber(info.idealThreads));
  push("settings.textEngine.info.totalSequences", formatNumber(info.totalSequences));
  push("settings.textEngine.info.ggufVersion", formatNumber(info.ggufVersion));
  push("settings.textEngine.info.baseUrl", baseUrl);

  return (
    <SettingsGroupCard>
      <div className="space-y-3 px-4 py-3">
        <div className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "settings.textEngine.info.title" })}
        </div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/40 pb-1"
            >
              <dt className="shrink-0 text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: entry.id })}
              </dt>
              <dd
                className="min-w-0 truncate text-right font-mono text-ui-sm text-foreground"
                title={entry.value}
              >
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </SettingsGroupCard>
  );
}
