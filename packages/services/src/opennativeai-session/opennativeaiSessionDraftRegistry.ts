import type { OpenNativeAISessionStateSnapshot } from "@opennativeai/shared";
import type {
  OpenNativeAISessionWorkspaceTarget,
  OpenNativeAITaskTarget,
} from "#src/opennativeai-session/opennativeaiSession.js";

function getWorkspaceKey(target: OpenNativeAISessionWorkspaceTarget): string {
  return target.workspaceIdentity?.trim() || target.workspacePath;
}

function getSessionScopedKey(target: OpenNativeAITaskTarget): string {
  return `${getWorkspaceKey(target)}\0${target.sessionId}`;
}

export function createOpenNativeAIDeferredDraftRegistry() {
  const sessionKeys = new Set<string>();

  return {
    remember(params: OpenNativeAISessionWorkspaceTarget, snapshot: OpenNativeAISessionStateSnapshot): void {
      sessionKeys.add(
        getSessionScopedKey({
          workspacePath: snapshot.session.workspace.workspacePath,
          workspaceIdentity:
            snapshot.session.workspace.workspaceIdentity ?? params.workspaceIdentity,
          sessionId: snapshot.session.sessionId,
        }),
      );
    },

    has(target: OpenNativeAITaskTarget): boolean {
      return sessionKeys.has(getSessionScopedKey(target));
    },

    forget(target: OpenNativeAITaskTarget): void {
      sessionKeys.delete(getSessionScopedKey(target));
    },
  };
}
