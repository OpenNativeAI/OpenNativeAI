import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { OpenNativeAIProvider } from "./opennativeai-task-types-core.js";

export const OPENNATIVEAI_AGENT_PROVIDER = "glm" satisfies OpenNativeAIProvider;
export const OPENNATIVEAI_AGENT_PROVIDER_LABEL = "OpenNativeAI Agent";
export const OPENNATIVEAI_COMMAND_AGENT_SOURCE = "opennativeaiAgent" satisfies CommandAgentSource;

export const opennativeaiAgentProviderSchema = z.literal(OPENNATIVEAI_AGENT_PROVIDER);

export const OPENNATIVEAI_COMMAND_AGENT_SOURCES = [
  OPENNATIVEAI_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToOpenNativeAIAgent(
  _provider?: OpenNativeAIProvider | null,
): OpenNativeAIProvider {
  return OPENNATIVEAI_AGENT_PROVIDER;
}

export function isOpenNativeAIAgentProvider(
  provider: OpenNativeAIProvider | null | undefined,
): provider is typeof OPENNATIVEAI_AGENT_PROVIDER {
  return provider === OPENNATIVEAI_AGENT_PROVIDER;
}
