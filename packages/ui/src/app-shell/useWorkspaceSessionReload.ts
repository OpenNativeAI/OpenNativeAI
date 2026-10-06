import { useCallback, useRef, useState } from "react";
import type { IServiceAccessor } from "@opennativeai/services";
import type { OpenNativeAIProvider } from "@opennativeai/shared";
import { toast } from "@/components/ui/toast.js";
import {
  buildWorkspaceSessionReloadDraftError,
  shouldDebounceWorkspaceSessionReload,
} from "@/lib/workspaceSessionReloadPlan.js";
import { resolveWorkspaceModelConfigSyncScope } from "@/lib/modelConfigSync.js";
import { prepareWorkspaceWithOpenNativeAISessionService } from "@/hooks/useWorkspacePrepare.js";
import { logger } from "@/logger.js";
import { useOpenNativeAISessionStore } from "@/store/opennativeaiSessionStore.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";

export function useWorkspaceSessionReload({
  intl,
  services,
  workspaceAbsPath,
  reloadSessionDisabled,
}: {
  intl: { formatMessage: (descriptor: { id: string }) => string };
  services: IServiceAccessor;
  workspaceAbsPath: string;
  reloadSessionDisabled: boolean;
}) {
  const [reloadSessionPending, setReloadSessionPending] = useState(false);
  const workspaceIdentity = useTabStore((state) => {
    if (!state.activeTabId) {
      return undefined;
    }

    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (!activeTab || !isWorkspaceTab(activeTab) || activeTab.workspacePath !== workspaceAbsPath) {
      return undefined;
    }

    return activeTab.workspaceIdentity;
  });
  const lastReloadSessionTriggeredAtRef = useRef<number | null>(null);

  const handleReloadSession = useCallback(
    async (options?: { resumeTaskId?: string | null; provider?: OpenNativeAIProvider | null }) => {
      if (reloadSessionDisabled || reloadSessionPending) {
        return;
      }

      const now = Date.now();
      if (shouldDebounceWorkspaceSessionReload(lastReloadSessionTriggeredAtRef.current, now)) {
        // Header 与错误条都可触发 reload，会出现短时间双击/连点并发重建。
        // 这里在入口做时间窗防抖，避免并发调用 restartWorkspaceProcess 抢占同一 provider-workspace。
        logger.info(`[App] 忽略重复 workspace session 重建请求 workspace=${workspaceAbsPath}`);
        return;
      }
      lastReloadSessionTriggeredAtRef.current = now;
      setReloadSessionPending(true);

      const opennativeaiSessionStore = useOpenNativeAISessionStore.getState();
      const latestWorkspaceState = opennativeaiSessionStore.getWorkspaceState(
        workspaceAbsPath,
        workspaceIdentity,
      );
      const actionScope = resolveWorkspaceModelConfigSyncScope(latestWorkspaceState);
      const provider: OpenNativeAIProvider = options?.provider ?? actionScope.provider;
      const resumeTaskId =
        options?.resumeTaskId?.trim() || latestWorkspaceState.activeTaskId || undefined;
      const shouldPrepareWorkspace = !resumeTaskId;

      // Reload session 之前只调用了服务层重建流程，没有同步 workspaceInit 状态到 UI store。
      // 草稿态下后续准备流程会继续读到旧状态，用户会误判本次重建没有生效。
      // 这里显式写入 initializing/ready/failed，保证重建状态和会话流程保持一致。
      opennativeaiSessionStore.setWorkspaceInitState(
        workspaceAbsPath,
        "initializing",
        null,
        workspaceIdentity,
      );
      if (shouldPrepareWorkspace) {
        opennativeaiSessionStore.setConfigOptionsStatus(workspaceAbsPath, "loading", workspaceIdentity);
        // 草稿态点击 reload 后若不清空旧错误，输入区会继续显示上一轮失败提示，
        // 用户会误判本次重建仍失败。这里在新一轮重建开始时先清空草稿错误。
        opennativeaiSessionStore.setDraftError(workspaceAbsPath, null, workspaceIdentity);
        opennativeaiSessionStore.setTaskState(workspaceAbsPath, "idle", null, workspaceIdentity);
      }

      try {
        await services.opennativeaiTaskService.restartWorkspaceProcess({
          workspacePath: workspaceAbsPath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
          provider,
          resumeTaskId,
        });

        if (shouldPrepareWorkspace) {
          const prepareResult = await prepareWorkspaceWithOpenNativeAISessionService({
            workspacePath: workspaceAbsPath,
            workspaceIdentity,
            provider,
            opennativeaiSessionService: services.opennativeaiSessionService,
          });

          const latestAfterPrepare = opennativeaiSessionStore.getWorkspaceState(
            workspaceAbsPath,
            workspaceIdentity,
          );
          if (latestAfterPrepare.selectedProvider === provider) {
            const latestAfterResolve = opennativeaiSessionStore.getWorkspaceState(
              workspaceAbsPath,
              workspaceIdentity,
            );
            if (latestAfterResolve.selectedProvider === provider) {
              opennativeaiSessionStore.setConfigOptions(
                workspaceAbsPath,
                prepareResult.configOptions ?? [],
                workspaceIdentity,
              );
              opennativeaiSessionStore.setConfigOptionsStatus(
                workspaceAbsPath,
                "ready",
                workspaceIdentity,
              );
              opennativeaiSessionStore.setSlashCommands(
                workspaceAbsPath,
                prepareResult.slashCommands ?? [],
                workspaceIdentity,
              );
              opennativeaiSessionStore.setDraftError(workspaceAbsPath, null, workspaceIdentity);
            }
          }
        }

        opennativeaiSessionStore.setWorkspaceInitAttempts(workspaceAbsPath, 0, workspaceIdentity);
        opennativeaiSessionStore.setWorkspaceInitState(workspaceAbsPath, "ready", null, workspaceIdentity);

        logger.info(
          `[App] workspace session 重建完成 workspace=${workspaceAbsPath} provider=${provider} resumeTaskId=${resumeTaskId ?? "<none>"}`,
        );
        toast(intl.formatMessage({ id: "appHeader.reloadSessionSuccess" }));
      } catch (error) {
        const reloadDraftError = buildWorkspaceSessionReloadDraftError(error, {
          workspacePath: workspaceAbsPath,
          provider,
        });
        const message = reloadDraftError.message;
        logger.warn(
          `[App] workspace session 重建失败 workspace=${workspaceAbsPath} provider=${provider}`,
          {
            resumeTaskId: resumeTaskId ?? null,
            message,
          },
        );
        opennativeaiSessionStore.setWorkspaceInitState(
          workspaceAbsPath,
          "failed",
          message,
          workspaceIdentity,
        );
        if (shouldPrepareWorkspace) {
          opennativeaiSessionStore.setConfigOptionsStatus(workspaceAbsPath, "error", workspaceIdentity);
          // 草稿态下 reload 前会先清空旧错误；如果失败后不回填 draftError，
          // 聊天区只剩 toast，用户看不到可重试的详细报错。这里统一回填标准化错误到输入区。
          opennativeaiSessionStore.setDraftError(workspaceAbsPath, reloadDraftError, workspaceIdentity);
        }
        toast(intl.formatMessage({ id: "appHeader.reloadSessionFailed" }));
      } finally {
        setReloadSessionPending(false);
      }
    },
    [
      intl,
      reloadSessionDisabled,
      reloadSessionPending,
      services.opennativeaiTaskService,
      services.opennativeaiSessionService,
      workspaceAbsPath,
      workspaceIdentity,
    ],
  );

  return {
    reloadSessionPending,
    handleReloadSession,
  };
}
