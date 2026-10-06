import {
  opennativeaiProtocolMethods,
  opennativeaiPluginsReferenceCatalogResultSchema,
  type OpenNativeAIPluginsReferenceCatalogParams,
} from "@opennativeai/shared";
import type { OpenNativeAIProtocolClient } from "#src/opennativeai-agent/opennativeaiProtocolClient.js";

/** 旧协议严格校验响应；新展示字段走独立入口，只有 -32601 能证明旧 Agent 不支持。 */
export async function requestPluginReferenceCatalog(
  client: Pick<OpenNativeAIProtocolClient, "request">,
  params: OpenNativeAIPluginsReferenceCatalogParams,
) {
  try {
    return await client.request(
      opennativeaiProtocolMethods.pluginsReferenceCatalogWithCategory,
      params,
      opennativeaiPluginsReferenceCatalogResultSchema,
    );
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === -32601))
      throw error;
    return client.request(
      opennativeaiProtocolMethods.pluginsReferenceCatalog,
      params,
      opennativeaiPluginsReferenceCatalogResultSchema,
    );
  }
}
