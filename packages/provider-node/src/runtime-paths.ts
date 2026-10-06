export const OPENNATIVEAI_BUILTIN_PROVIDER_CONFIG_FILE_ENV = "OPENNATIVEAI_BUILTIN_PROVIDER_CONFIG_FILE";
export const OPENNATIVEAI_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV =
  "OPENNATIVEAI_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE";
export const OPENNATIVEAI_PERSONAL_PROVIDER_CONFIG_FILE_ENV = "OPENNATIVEAI_PERSONAL_PROVIDER_CONFIG_FILE";
export const PERSONAL_PROVIDER_CONFIG_FILE_NAME = "provider_config.json";

export interface NodeProviderRuntimePaths {
  readonly opennativeaiBuiltinFilePath: string;
  readonly personalFilePath: string;
}

export function createNodeProviderRuntimePathEnv(
  paths: NodeProviderRuntimePaths,
): Record<string, string> {
  return {
    [OPENNATIVEAI_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: paths.opennativeaiBuiltinFilePath,
    [OPENNATIVEAI_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: paths.personalFilePath,
  };
}

export function resolveNodeProviderRuntimePaths(
  env: Readonly<Record<string, string | undefined>>,
): NodeProviderRuntimePaths | null {
  const opennativeaiBuiltinFilePath = env[OPENNATIVEAI_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const personalFilePath = env[OPENNATIVEAI_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  if (!opennativeaiBuiltinFilePath && !personalFilePath) return null;
  if (!opennativeaiBuiltinFilePath || !personalFilePath) {
    throw new Error("OpenNativeAI Built-in 与 Personal Provider Config 路径必须同时提供");
  }
  return Object.freeze({ opennativeaiBuiltinFilePath, personalFilePath });
}
