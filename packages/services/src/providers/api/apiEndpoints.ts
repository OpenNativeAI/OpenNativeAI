import { buildRuntimeOpenNativeAIApiUrl, resolveZaiBusinessBaseUrl } from "@opennativeai/shared";

export const OPENNATIVEAI_CLIENT_SCENES_URL = buildRuntimeOpenNativeAIApiUrl(
  process.env,
  "/api/v1/client/scenes",
);

export const ZAI_API_HOST = resolveZaiBusinessBaseUrl(process.env);
