/**
 * OpenNativeAI Agent Slash Commands 便捷 hook
 *
 * 返回当前 workspace 下 Agent 广播的可用 slash commands 列表。
 */
import { useOpenNativeAISessionStore, selectWorkspaceOpenNativeAIState } from "../store/opennativeaiSessionStore.js";

export function useSlashCommands(workspacePath: string, workspaceIdentity?: string) {
  return useOpenNativeAISessionStore(
    (state) => selectWorkspaceOpenNativeAIState(state, workspacePath, workspaceIdentity).slashCommands,
  );
}
