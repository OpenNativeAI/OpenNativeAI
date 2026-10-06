import { loadBuiltinProviderConfig } from "../../../../../scripts/builtin-provider-config.mjs";

export const SEA_OPENNATIVEAI_BUILTIN_PROVIDER_CONFIG_ASSET_KEY = "opennativeai-provider/opennativeai-builtin.json";

export const collectSeaProviderConfigAssets = async ({ root, env = process.env }) => {
  const { sourcePath } = await loadBuiltinProviderConfig({ root, env });
  return {
    [SEA_OPENNATIVEAI_BUILTIN_PROVIDER_CONFIG_ASSET_KEY]: sourcePath,
  };
};
