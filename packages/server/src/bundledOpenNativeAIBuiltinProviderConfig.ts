import { materializeOpenNativeAIBuiltinProviderConfig } from "@opennativeai/services/node";

declare const __OPENNATIVEAI_BUILTIN_PROVIDER_CONFIG_JSON__: string | undefined;

interface MaterializeBundledOpenNativeAIBuiltinProviderConfigOptions {
  readonly environmentConfigRoot: string;
  readonly content: string;
}

/** 返回构建时嵌入远端 Server 的 OpenNativeAI Built-in Provider Config。 */
export function readBundledOpenNativeAIBuiltinProviderConfig(): string {
  if (typeof __OPENNATIVEAI_BUILTIN_PROVIDER_CONFIG_JSON__ !== "string") {
    throw new Error("当前构建未嵌入 OpenNativeAI Built-in Provider Config");
  }
  return __OPENNATIVEAI_BUILTIN_PROVIDER_CONFIG_JSON__;
}

/**
 * 将 OpenNativeAI Built-in Config 原子物化到所属环境的固定资源副本。
 * 升级前退出旧进程；不保留按内容 hash 增长的历史文件。
 */
export async function materializeBundledOpenNativeAIBuiltinProviderConfig(
  options: MaterializeBundledOpenNativeAIBuiltinProviderConfigOptions,
): Promise<string> {
  return materializeOpenNativeAIBuiltinProviderConfig(options);
}
