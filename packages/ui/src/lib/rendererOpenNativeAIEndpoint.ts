import {
  buildRuntimeOpenNativeAIEndpointUrls,
  OPENNATIVEAI_ENV,
  type RuntimeOpenNativeAIEndpointEnv,
} from "@opennativeai/shared";

interface RendererImportMetaEnv {
  VITE_OPENNATIVEAI_BASE_URL?: string;
  VITE_OPENNATIVEAI_ENDPOINT_ORIGIN?: string;
}

function readRendererImportMetaEnv(): RendererImportMetaEnv {
  return ((import.meta as ImportMeta & { env?: RendererImportMetaEnv }).env ??
    {}) as RendererImportMetaEnv;
}

function createRendererOpenNativeAIEndpointEnv(
  env: RendererImportMetaEnv = readRendererImportMetaEnv(),
): RuntimeOpenNativeAIEndpointEnv {
  return {
    OPENNATIVEAI_ENV,
    // UI 侧的 opennativeai-plan 占位 provider 以前只看 OPENNATIVEAI_ENV，
    // 没有消费 Vite 注入的 base url，导致自定义测试域名时 renderer 和 host/service 可能不一致。
    OPENNATIVEAI_BASE_URL: env.VITE_OPENNATIVEAI_BASE_URL,
    OPENNATIVEAI_ENDPOINT_ORIGIN: env.VITE_OPENNATIVEAI_ENDPOINT_ORIGIN,
  };
}

export const RENDERER_OPENNATIVEAI_ENDPOINT_URLS = buildRuntimeOpenNativeAIEndpointUrls(
  createRendererOpenNativeAIEndpointEnv(),
);
