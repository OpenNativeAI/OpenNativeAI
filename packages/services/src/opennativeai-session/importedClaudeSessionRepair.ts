import type { OpenNativeAISessionStateSnapshot } from "@opennativeai/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { repairImportedClaudeSessionSnapshot } from "#src/session/claude-native/importedClaudeHistoryRepair.js";
import type { IOpenNativeAIAgentService } from "#src/opennativeai-agent/opennativeaiAgent.js";
import type {
  OpenNativeAISessionReadParams,
  OpenNativeAISessionResumeParams,
} from "#src/opennativeai-session/opennativeaiSession.js";

const logger = createServiceLogger("opennativeai-session-service");

export async function repairEmptyImportedClaudeSessionSnapshot(params: {
  agentService: IOpenNativeAIAgentService;
  snapshot: OpenNativeAISessionStateSnapshot;
  target: OpenNativeAISessionResumeParams | OpenNativeAISessionReadParams;
}): Promise<OpenNativeAISessionStateSnapshot> {
  const repaired = await repairImportedClaudeSessionSnapshot({
    snapshot: params.snapshot,
    target: {
      workspacePath: params.target.workspacePath,
      workspaceIdentity: params.target.workspaceIdentity,
      taskId: params.target.sessionId,
      ...("mcpServers" in params.target && params.target.mcpServers
        ? { mcpServers: params.target.mcpServers }
        : {}),
    },
    createSession: (input) => params.agentService.createSession(input),
    onRepair: (history) => {
      logger.warn(
        undefined,
        `[opennativeai-session-service] Claude 导入 session 历史异常，按 ${history.source} 回填 taskId=${params.target.sessionId}`,
      );
    },
  });
  return repaired ?? params.snapshot;
}
