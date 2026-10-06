import { GgmlType, type LlamaContext, type LlamaModel } from "node-llama-cpp";
import type { LocalEngineModelInfo } from "@opennativeai/shared";

/**
 * 从 node-llama-cpp 原生对象采集运行时/模型详情（供设置面板展示）。
 * 每个字段独立读取并吞掉异常：不同架构/量化文件的 getter 可能不可用，取不到就省略，绝不伪造数值。
 * 内存（RAM/VRAM）为 node-llama-cpp 估算值，模型 + 上下文合并统计。
 */
export function buildModelInfo(
  model: LlamaModel,
  context: LlamaContext | undefined,
  keepInMemory: boolean,
): LocalEngineModelInfo {
  const info: LocalEngineModelInfo = { loadedToMemory: true, residentLocked: keepInMemory };
  const read = <K extends keyof LocalEngineModelInfo>(
    key: K,
    value: () => LocalEngineModelInfo[K],
  ): void => {
    try {
      const resolved = value();
      if (resolved !== undefined && resolved !== null) {
        info[key] = resolved;
      }
    } catch {
      // 该字段在当前模型上不可用，跳过。
    }
  };
  read("modelFileName", () => model.filename);
  read("architecture", () => model.architecture);
  read("trainContextSize", () => model.trainContextSize);
  read("embeddingVectorSize", () => model.embeddingVectorSize);
  read("gpuLayers", () => model.gpuLayers);
  read("modelSizeBytes", () => model.size);
  read("usesMmap", () => model.useMmap);
  read("gpuActive", () => model.gpuLayers > 0);
  read("vocabularyType", () => model.vocabularyType);
  read("supportedByLlamaCpp", () => model.fileInsights.isSupportedByLlamaCpp);
  read("displayName", () => model.fileInfo.metadata.general?.name);
  read("ggufVersion", () => model.fileInfo.version);
  read("quantizationType", () => {
    const tensorType = model.fileInsights.dominantTensorType;
    // GgmlType 为数值枚举，反查得标签（如 Q4_K）；undefined 时交给 read 跳过。
    return tensorType === undefined ? undefined : GgmlType[tensorType];
  });
  read("parameterCount", () => model.fileInsights.totalParameters);
  read("totalLayers", () => model.fileInsights.totalLayers);
  if (context) {
    read("contextSize", () => context.contextSize);
    read("batchSize", () => context.batchSize);
    read("threads", () => context.currentThreads);
    read("idealThreads", () => context.idealThreads);
    read("totalSequences", () => context.totalSequences);
    // context.flashAttention 可能为 "auto"：自动时依据模型是否支持 Flash Attention 判定实际生效值。
    read("flashAttention", () => {
      const fa = context.flashAttention;
      return fa === "auto" ? model.flashAttentionSupported : fa;
    });
  }
  // 内存占用分模型权重与上下文（KV cache）两部分，分别取 ram/vram；任一侧读取失败只影响该侧，不伪造。
  try {
    const modelMem = model.memoryUsage;
    if (modelMem) {
      info.modelRamUsageBytes = modelMem.ram;
      info.modelVramUsageBytes = modelMem.vram;
    }
  } catch {
    // 模型内存不可读。
  }
  try {
    const contextMem = context?.memoryUsage;
    if (contextMem) {
      info.contextRamUsageBytes = contextMem.ram;
      info.contextVramUsageBytes = contextMem.vram;
    }
  } catch {
    // 上下文内存不可读。
  }
  // 合计 = 模型 + 上下文（仅当至少一侧可用时给出，缺失侧按 0）。
  if (info.modelRamUsageBytes !== undefined || info.contextRamUsageBytes !== undefined) {
    info.ramUsageBytes = (info.modelRamUsageBytes ?? 0) + (info.contextRamUsageBytes ?? 0);
  }
  if (info.modelVramUsageBytes !== undefined || info.contextVramUsageBytes !== undefined) {
    info.vramUsageBytes = (info.modelVramUsageBytes ?? 0) + (info.contextVramUsageBytes ?? 0);
  }
  return info;
}
