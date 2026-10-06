import type { ISkillsService } from "@opennativeai/services";
import {
  normalizeAgentProviderToOpenNativeAIAgent,
  OPENNATIVEAI_AGENT_PROVIDER,
  type OpenNativeAIProvider,
} from "@opennativeai/shared";
import { useSkillStore } from "@/store/skillStore.js";

export async function refreshSharedSkillStoreForWorkspace(params: {
  workspacePath: string | null | undefined;
  workspaceIdentity?: string | null;
  skillsService: ISkillsService;
  provider?: OpenNativeAIProvider;
}): Promise<void> {
  const workspacePath = params.workspacePath;
  if (!workspacePath) {
    return;
  }
  const skillStore = useSkillStore.getState();
  const normalizedWorkspaceIdentity = params.workspaceIdentity?.trim() || null;
  const normalizedProvider = normalizeAgentProviderToOpenNativeAIAgent(
    params.provider ?? OPENNATIVEAI_AGENT_PROVIDER,
  );
  const refreshes: Promise<void>[] = [];

  if (
    skillStore.workspacePath === workspacePath &&
    skillStore.workspaceIdentity === normalizedWorkspaceIdentity &&
    skillStore.loadedWorkspacePath === workspacePath &&
    skillStore.loadedWorkspaceIdentity === normalizedWorkspaceIdentity &&
    normalizeAgentProviderToOpenNativeAIAgent(skillStore.provider) === normalizedProvider &&
    skillStore.loadedProvider === normalizedProvider
  ) {
    refreshes.push(
      skillStore.refresh(params.skillsService, normalizedWorkspaceIdentity ?? undefined),
    );
  }

  await Promise.all(refreshes);
}
