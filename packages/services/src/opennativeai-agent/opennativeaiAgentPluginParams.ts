import type {
  OpenNativeAIAgentMcpServer,
  OpenNativeAIAutomationScheduleRule,
  OpenNativeAIMcpListMode,
  ModelSelection,
} from "@opennativeai/shared";

export interface OpenNativeAIAgentWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  /** 远程 workspace 的运行时会话身份；只用于隔离/路由，不能替代 workspacePath。 */
  remoteSessionId?: string;
}

export interface OpenNativeAIAgentPluginViewParams extends OpenNativeAIAgentWorkspaceTarget {
  configScope?: "user" | "workspace";
}

export interface OpenNativeAIAgentListMcpServerStatusesParams extends OpenNativeAIAgentWorkspaceTarget {
  mcpServers?: OpenNativeAIAgentMcpServer[];
  mode?: OpenNativeAIMcpListMode;
}

export interface OpenNativeAIAgentAddPluginMarketplaceParams extends OpenNativeAIAgentWorkspaceTarget {
  dryRun?: boolean;
  operationId?: string;
  source: string;
}

export interface OpenNativeAIAgentRemovePluginMarketplaceParams extends OpenNativeAIAgentWorkspaceTarget {
  marketplace: string;
}

export interface OpenNativeAIAgentUpdatePluginMarketplaceParams extends OpenNativeAIAgentWorkspaceTarget {
  marketplace?: string;
  operationId?: string;
}

export interface OpenNativeAIAgentInstallPluginParams extends OpenNativeAIAgentWorkspaceTarget {
  dryRun?: boolean;
  marketplace: string;
  operationId?: string;
  pluginName: string;
  scope?: "user" | "workspace";
}

export interface OpenNativeAIAgentCancelPluginOperationParams {
  operationId: string;
}

export interface OpenNativeAIAgentUninstallPluginParams extends OpenNativeAIAgentWorkspaceTarget {
  marketplace?: string;
  pluginId?: string;
  pluginName?: string;
  removeCache?: boolean;
}

export interface OpenNativeAIAgentUpdatePluginParams extends OpenNativeAIAgentWorkspaceTarget {
  pluginId?: string;
  marketplace?: string;
}

export interface OpenNativeAIAgentRestoreBuiltinPluginParams extends OpenNativeAIAgentWorkspaceTarget {
  pluginId: string;
}

export interface OpenNativeAIAgentConfigurePluginParams extends OpenNativeAIAgentWorkspaceTarget {
  clearOptionKeys?: string[];
  dryRun?: boolean;
  options: Record<string, unknown>;
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface OpenNativeAIAgentResetPluginConfigParams extends OpenNativeAIAgentWorkspaceTarget {
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface OpenNativeAIAgentValidatePluginParams extends OpenNativeAIAgentWorkspaceTarget {
  marketplace?: string;
  pluginName?: string;
  source?: string;
}

export interface OpenNativeAIAgentDescribePluginParams extends OpenNativeAIAgentWorkspaceTarget {
  marketplace: string;
  pluginName: string;
}

export interface OpenNativeAIAgentSetPluginEnabledParams extends OpenNativeAIAgentWorkspaceTarget {
  enabled: boolean;
  operationId?: string;
  pluginId: string;
  scope?: "user" | "workspace";
}

// Plugin 对话引用 catalog：
// 带 sessionId → session-owned 冻结 catalog（必须路由到持有该 session 的 workspace client）；
// 不带 → workspace 当前 catalog（新建草稿 Picker）。
export interface OpenNativeAIAgentPluginReferenceCatalogParams extends OpenNativeAIAgentWorkspaceTarget {
  sessionId?: string;
}

// Composer Skill catalog：与 Plugin 引用相同，以 sessionId 区分 workspace 当前目录和
// resident Session runtime 快照；不参与 Settings 管理目录。
export interface OpenNativeAIAgentSkillReferenceCatalogParams extends OpenNativeAIAgentWorkspaceTarget {
  sessionId?: string;
}
export interface OpenNativeAIAgentResolveSuggestedPluginReferenceParams extends OpenNativeAIAgentWorkspaceTarget {
  stableId: string;
  operationId: string;
  clientMode: "desktop-continuous" | "web-remote-replayable";
  deliveryKind: "desktop-continuous" | "web-remote-replayable";
}

// ---- 定时任务(automation)管理参数 ----

export interface OpenNativeAIAgentCreateAutomationParams extends OpenNativeAIAgentWorkspaceTarget {
  title: string;
  cronExpr: string;
  relativeDelayMinutes?: number;
  prompt: string;
  modelSelection?: ModelSelection;
  mode?: string;
  recurring?: boolean;
  maxRuns?: number;
  endAt?: number;
  scheduleRule?: OpenNativeAIAutomationScheduleRule;
}

export interface OpenNativeAIAgentUpdateAutomationParams extends OpenNativeAIAgentWorkspaceTarget {
  automationId: string;
  title?: string;
  cronExpr?: string;
  prompt?: string;
  modelSelection?: ModelSelection | null;
  mode?: string | null;
  recurring?: boolean;
  maxRuns?: number | null;
  endAt?: number | null;
  scheduleRule?: OpenNativeAIAutomationScheduleRule | null;
  scheduleEditedByUser?: boolean;
}

export interface OpenNativeAIAgentAutomationIdParams extends OpenNativeAIAgentWorkspaceTarget {
  automationId: string;
}

export interface OpenNativeAIAgentSetAutomationEnabledParams extends OpenNativeAIAgentWorkspaceTarget {
  automationId: string;
  enabled: boolean;
}

export interface OpenNativeAIAgentDeleteAutomationRunParams extends OpenNativeAIAgentWorkspaceTarget {
  runId: string;
}
