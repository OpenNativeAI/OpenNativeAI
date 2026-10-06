import { ServiceChannels } from "@opennativeai/shared";
import type {
  TraceId,
  OpenNativeAIAgentMcpServer,
  OpenNativeAIDeliveryKind,
  OpenNativeAIMessageWithParts,
  ModelSelection,
  OpenNativeAIPermissionRequestParams,
  OpenNativeAIUserInputRequestParams,
  OpenNativeAIUserInputResponse,
  OpenNativeAISessionInfo,
  OpenNativeAISessionImportHistory,
  OpenNativeAISessionEvent,
  OpenNativeAISessionMode,
  OpenNativeAISessionPersistence,
  OpenNativeAISessionStateSnapshot,
  OpenNativeAIStateUpdatedNotification,
  OpenNativeAIWorkspacePresentation,
} from "@opennativeai/shared";
import { createServiceDescriptor } from "#src/descriptors.js";

export interface OpenNativeAISessionWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export type OpenNativeAISessionReadWorkspacePresentationParams = OpenNativeAISessionWorkspaceTarget;

export interface OpenNativeAITaskTarget extends OpenNativeAISessionWorkspaceTarget {
  sessionId: string;
}

export interface OpenNativeAISessionCreateParams extends OpenNativeAISessionWorkspaceTarget {
  /** 仅导入事务使用的预分配 ID；普通新会话继续由 Agent 分配。 */
  sessionId?: string;
  sessionTraceId?: TraceId;
  parentSessionId?: string;
  mode?: OpenNativeAISessionMode;
  model?: ModelSelection;
  persistence?: OpenNativeAISessionPersistence;
  thoughtLevel?: string;
  mcpServers?: OpenNativeAIAgentMcpServer[];
  importedHistory?: OpenNativeAISessionImportHistory;
}

export interface OpenNativeAISessionResumeParams extends OpenNativeAITaskTarget {
  model?: ModelSelection;
  thoughtLevel?: string;
  mcpServers?: OpenNativeAIAgentMcpServer[];
  /**
   * 默认广播 resume 得到的历史快照，并让 shadow 订阅请求初始 snapshot。
   * 续聊发送前的 runtime 预恢复会关闭它，避免旧终态快照覆盖本地已开始的新输入运行态。
   */
  broadcastSnapshot?: boolean;
}

export interface OpenNativeAISessionListParams extends OpenNativeAISessionWorkspaceTarget {
  includeArchived?: boolean;
  limit?: number;
}

export interface OpenNativeAISessionReadParams extends OpenNativeAITaskTarget {
  deliveryKind?: OpenNativeAIDeliveryKind;
  messageLimit?: number;
  afterSeq?: number;
}

export interface OpenNativeAISessionMessagesParams extends OpenNativeAITaskTarget {
  afterMessageId?: string;
  limit?: number;
}

export interface OpenNativeAISessionEventsParams extends OpenNativeAITaskTarget {
  afterSeq?: number;
  limit?: number;
}

export interface OpenNativeAISessionSetModelParams extends OpenNativeAITaskTarget {
  model: ModelSelection;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface OpenNativeAISessionSetThoughtLevelParams extends OpenNativeAITaskTarget {
  thoughtLevel?: string;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface OpenNativeAISessionSetModeParams extends OpenNativeAITaskTarget {
  mode: OpenNativeAISessionMode;
  expectedRevision?: number;
}

export interface OpenNativeAISessionSubscribeParams extends OpenNativeAITaskTarget {
  deliveryKind: OpenNativeAIDeliveryKind;
  afterSeq?: number;
  includeSnapshot?: boolean;
  eventCoalescing?: {
    mode: "background-summary";
    intervalMs?: number;
  };
}

export type OpenNativeAISessionServiceEvent =
  | { type: "session.event"; event: OpenNativeAISessionEvent }
  | { type: "state.updated"; notification: OpenNativeAIStateUpdatedNotification }
  | { type: "permission.request"; request: OpenNativeAIPermissionRequestParams }
  | { type: "userInput.request"; request: OpenNativeAIUserInputRequestParams }
  | {
      type: "userInput.response";
      requestId: string;
      response: OpenNativeAIUserInputResponse;
    }
  | { type: "snapshot"; snapshot: OpenNativeAISessionStateSnapshot };

export interface OpenNativeAISessionInitializeResult {
  available: boolean;
  workspaceKey: string;
  protocolName?: string;
  protocolVersion?: number;
  transportKind?: "stdio" | "websocket";
  reason?: string;
  reasonCode?: "provider_not_ready";
}

export interface OpenNativeAISessionWorkspaceRuntimeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
}

export interface IOpenNativeAISessionService {
  initializeWorkspace(params: OpenNativeAISessionWorkspaceTarget): Promise<OpenNativeAISessionInitializeResult>;
  getWorkspaceRuntimeIdentity(
    params: OpenNativeAISessionWorkspaceTarget,
  ): Promise<OpenNativeAISessionWorkspaceRuntimeIdentity>;
  readWorkspacePresentation(
    params: OpenNativeAISessionReadWorkspacePresentationParams,
  ): Promise<OpenNativeAIWorkspacePresentation>;
  createSession(params: OpenNativeAISessionCreateParams): Promise<OpenNativeAISessionStateSnapshot>;
  resumeSession(params: OpenNativeAISessionResumeParams): Promise<OpenNativeAISessionStateSnapshot>;
  listSessions(params: OpenNativeAISessionListParams): Promise<OpenNativeAISessionInfo[]>;
  readSession(params: OpenNativeAISessionReadParams): Promise<OpenNativeAISessionStateSnapshot>;
  readSessionMessages(params: OpenNativeAISessionMessagesParams): Promise<OpenNativeAIMessageWithParts[]>;
  readSessionEvents(params: OpenNativeAISessionEventsParams): Promise<OpenNativeAISessionEvent[]>;
  promoteDeferredDraftSession(params: OpenNativeAITaskTarget): Promise<void>;
  closeSession(params: OpenNativeAITaskTarget): Promise<void>;
  closeDeferredDraftSession(params: OpenNativeAITaskTarget): Promise<boolean>;
  setModel(params: OpenNativeAISessionSetModelParams): Promise<OpenNativeAISessionStateSnapshot>;
  setThoughtLevel(params: OpenNativeAISessionSetThoughtLevelParams): Promise<OpenNativeAISessionStateSnapshot>;
  setMode(params: OpenNativeAISessionSetModeParams): Promise<OpenNativeAISessionStateSnapshot>;
  // renderer 订阅面走 agentService 的 conversation/sessions-index 帧通道。
}

export const IOpenNativeAISessionService = createServiceDescriptor<IOpenNativeAISessionService>(
  ServiceChannels.OpenNativeAISession,
);
