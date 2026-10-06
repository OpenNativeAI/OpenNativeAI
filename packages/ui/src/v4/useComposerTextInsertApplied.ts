import { useCallback } from "react";
import { useOpenNativeAISessionStore } from "@/store/opennativeaiSessionStore.js";

export function useComposerTextInsertApplied(workspacePath: string, workspaceIdentity?: string) {
  return useCallback(
    (requestId: number, signal: AbortSignal) =>
      new Promise<boolean>((resolve) => {
        let unsubscribe: () => void = () => undefined;
        let settled = false;
        const finish = (applied: boolean) => {
          if (settled) return;
          settled = true;
          unsubscribe();
          signal.removeEventListener("abort", handleAbort);
          resolve(applied);
        };
        const handleAbort = () => {
          const request = useOpenNativeAISessionStore
            .getState()
            .getWorkspaceState(workspacePath, workspaceIdentity).composerTextInsertRequest;
          finish(false);
          if (request?.requestId === requestId) {
            useOpenNativeAISessionStore
              .getState()
              .clearComposerTextInsertRequest(workspacePath, requestId, workspaceIdentity);
          }
        };
        const inspect = () => {
          const state = useOpenNativeAISessionStore
            .getState()
            .getWorkspaceState(workspacePath, workspaceIdentity);
          if (state.composerTextInsertVersion > requestId) {
            finish(false);
          } else if (
            state.composerTextInsertVersion === requestId &&
            state.composerTextInsertRequest === null
          ) {
            finish(true);
          }
        };
        if (signal.aborted) {
          resolve(false);
          return;
        }
        unsubscribe = useOpenNativeAISessionStore.subscribe(inspect);
        signal.addEventListener("abort", handleAbort, { once: true });
        inspect();
      }),
    [workspaceIdentity, workspacePath],
  );
}
