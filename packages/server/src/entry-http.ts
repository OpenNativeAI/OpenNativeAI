import { createLocalServices, getAppConfigDir } from "@opennativeai/services/node";
import {
  materializeBundledOpenNativeAIBuiltinProviderConfig,
  readBundledOpenNativeAIBuiltinProviderConfig,
} from "./bundledOpenNativeAIBuiltinProviderConfig.js";
import { createHttpServer } from "./http.js";

async function main(): Promise<void> {
  const opennativeaiBuiltinProviderConfigFilePath = await materializeBundledOpenNativeAIBuiltinProviderConfig({
    environmentConfigRoot: getAppConfigDir(),
    content: readBundledOpenNativeAIBuiltinProviderConfig(),
  });
  const port = Number(process.env["PORT"]) || 3030;
  const host = process.env["OPENNATIVEAI_SERVER_HOST"]?.trim() || process.env["HOST"]?.trim() || undefined;
  const staticRoot = process.env["OPENNATIVEAI_WEB_STATIC_ROOT"]?.trim() || undefined;
  const authToken = process.env["OPENNATIVEAI_SERVER_AUTH_TOKEN"]?.trim() || undefined;
  const services = createLocalServices({
    opennativeaiBuiltinProviderConfigFilePath,
    providerProvisioningTargetEnabled: Boolean(authToken),
  });

  createHttpServer(services, port, {
    ...(host ? { host } : {}),
    ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
    ...(authToken ? { authToken, authRequired: true } : {}),
  });
}

void main().catch((error: unknown) => {
  console.error("[opennativeai-server:http] startup failed", error);
  process.exitCode = 1;
});
