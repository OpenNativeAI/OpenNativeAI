/**
 * workspace prepare 的协议 RPC 收口。
 *
 * 拆出原因：useWorkspacePrepare.ts 只保留可单测的轻量判定入口；
 * 这里只读取 workspace presentation（mode/slash commands）；模型选择事实由目标 Host View 提供。
 */
import type { IOpenNativeAISessionService } from "@opennativeai/services";
import { type OpenNativeAIProvider, type OpenNativeAIWorkspacePrepareResult } from "@opennativeai/shared";
import { getChatErrorMessage } from "@/lib/chatPrepareError.js";
import { logger } from "@/logger.js";
import { opennativeaiWorkspacePresentationToConfigOptions } from "@/lib/opennativeaiSessionProjection.js";

export async function prepareWorkspaceWithOpenNativeAISessionService(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  provider: OpenNativeAIProvider;
  opennativeaiSessionService: Pick<IOpenNativeAISessionService, "readWorkspacePresentation">;
}): Promise<OpenNativeAIWorkspacePrepareResult> {
  const startedAt = Date.now();
  logger.info("[opennativeai-workspace-presentation] workspace prepare start", {
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity ?? null,
    provider: params.provider,
  });

  let presentation: Awaited<ReturnType<IOpenNativeAISessionService["readWorkspacePresentation"]>>;
  try {
    presentation = await params.opennativeaiSessionService.readWorkspacePresentation({
      workspacePath: params.workspacePath,
      workspaceIdentity: params.workspaceIdentity,
    });
  } catch (error) {
    logger.warn("[opennativeai-workspace-presentation] readWorkspacePresentation failed", {
      workspacePath: params.workspacePath,
      workspaceIdentity: params.workspaceIdentity ?? null,
      provider: params.provider,
      durationMs: Date.now() - startedAt,
      error: getChatErrorMessage(error),
    });
    throw error;
  }

  const readPresentationDurationMs = Date.now() - startedAt;
  const configOptions = opennativeaiWorkspacePresentationToConfigOptions(presentation.mode);
  const totalDurationMs = Date.now() - startedAt;
  logger.info("[opennativeai-workspace-presentation] readWorkspacePresentation done", {
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity ?? null,
    provider: params.provider,
    readPresentationDurationMs,
    totalDurationMs,
    configOptionsCount: configOptions.length,
    modeCurrent: presentation.mode,
  });

  return {
    workspacePath: params.workspacePath,
    preparedSessionId: "",
    version: "OpenNativeAI Protocol/1",
    provider: params.provider,
    configOptions,
    slashCommands: presentation.slashCommands,
  };
}
