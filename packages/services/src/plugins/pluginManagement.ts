// 平台能力面收敛：设置页「插件管理」的薄服务接口。
//
// 背景：pluginManagementStore / usePluginUninstall 过去直接注入 IOpenNativeAIAgentService，
// UI 层因此散布 13 个 plugins/* 旧协议词的消费点。收敛为独立薄 service 后，UI 只依赖
// 本接口；plugins/* 词表的 host 侧消费点收拢到 pluginManagementService 一处（插件的
// 事实源在 opennativeai-cli 进程，服务实现仍经 agent 协议往返——plugins 词表的收口归属
// 插件能力面自身的协议演进，不在会话 v4 词表范围内）。
// 注意与既有 IPluginsService（已 retired 的 marketplace pluginStore 通道）区分：
// 那套接口按 pluginName+marketplace 寻址且方法语义过时，不复用避免签名冲突。
import type { Event } from "@opennativeai/rpc";
import type {
  OpenNativeAIPluginOperationProgressNotification,
  OpenNativeAIPluginsConfigureResult,
  OpenNativeAIPluginsCancelOperationResult,
  OpenNativeAIPluginsDescribeResult,
  OpenNativeAIPluginsInstallResult,
  OpenNativeAIPluginsListResult,
  OpenNativeAIPluginsMarketplaceMutationResult,
  OpenNativeAIPluginsOverviewResult,
  OpenNativeAIPluginsReferenceCatalogResult,
  OpenNativeAIPluginsRestoreBuiltinResult,
  OpenNativeAIPluginsSetEnabledResult,
  OpenNativeAIPluginsUninstallResult,
  OpenNativeAIPluginsValidateResult,
} from "@opennativeai/shared";
import { ServiceChannels } from "@opennativeai/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  OpenNativeAIAgentAddPluginMarketplaceParams,
  OpenNativeAIAgentConfigurePluginParams,
  OpenNativeAIAgentCancelPluginOperationParams,
  OpenNativeAIAgentDescribePluginParams,
  OpenNativeAIAgentInstallPluginParams,
  OpenNativeAIAgentPluginReferenceCatalogParams,
  OpenNativeAIAgentResolveSuggestedPluginReferenceParams,
  OpenNativeAIAgentResetPluginConfigParams,
  OpenNativeAIAgentPluginViewParams,
  OpenNativeAIAgentRemovePluginMarketplaceParams,
  OpenNativeAIAgentRestoreBuiltinPluginParams,
  OpenNativeAIAgentSetPluginEnabledParams,
  OpenNativeAIAgentUninstallPluginParams,
  OpenNativeAIAgentUpdatePluginMarketplaceParams,
  OpenNativeAIAgentUpdatePluginParams,
  OpenNativeAIAgentValidatePluginParams,
} from "../opennativeai-agent/opennativeaiAgentPluginParams.js";

export interface IPluginManagementService {
  listPlugins(params: OpenNativeAIAgentPluginViewParams): Promise<OpenNativeAIPluginsListResult>;
  /**
   * Plugin 对话引用 catalog：
   * 带 sessionId → session-owned 冻结 catalog；不带 → workspace 当前 catalog。
   * 实现路由到 workspace 级 agent client，不走插件管理独立进程。
   */
  getPluginReferenceCatalog(
    params: OpenNativeAIAgentPluginReferenceCatalogParams,
  ): Promise<OpenNativeAIPluginsReferenceCatalogResult>;
  resolveSuggestedPluginReference(
    params: OpenNativeAIAgentResolveSuggestedPluginReferenceParams,
  ): Promise<import("@opennativeai/shared").OpenNativeAIPluginsResolveSuggestedReferenceResult>;
  onDynamicPluginOperationProgress(
    operationId: string,
  ): Event<OpenNativeAIPluginOperationProgressNotification>;
  getPluginsOverview(params: OpenNativeAIAgentPluginViewParams): Promise<OpenNativeAIPluginsOverviewResult>;
  addPluginMarketplace(
    params: OpenNativeAIAgentAddPluginMarketplaceParams,
  ): Promise<OpenNativeAIPluginsMarketplaceMutationResult>;
  removePluginMarketplace(
    params: OpenNativeAIAgentRemovePluginMarketplaceParams,
  ): Promise<OpenNativeAIPluginsMarketplaceMutationResult>;
  updatePluginMarketplace(
    params: OpenNativeAIAgentUpdatePluginMarketplaceParams,
  ): Promise<OpenNativeAIPluginsMarketplaceMutationResult>;
  installPlugin(params: OpenNativeAIAgentInstallPluginParams): Promise<OpenNativeAIPluginsInstallResult>;
  cancelPluginOperation(
    params: OpenNativeAIAgentCancelPluginOperationParams,
  ): Promise<OpenNativeAIPluginsCancelOperationResult>;
  uninstallPlugin(params: OpenNativeAIAgentUninstallPluginParams): Promise<OpenNativeAIPluginsUninstallResult>;
  updatePlugin(params: OpenNativeAIAgentUpdatePluginParams): Promise<OpenNativeAIPluginsInstallResult>;
  restoreBuiltinPlugin(
    params: OpenNativeAIAgentRestoreBuiltinPluginParams,
  ): Promise<OpenNativeAIPluginsRestoreBuiltinResult>;
  configurePlugin(params: OpenNativeAIAgentConfigurePluginParams): Promise<OpenNativeAIPluginsConfigureResult>;
  resetPluginConfig(
    params: OpenNativeAIAgentResetPluginConfigParams,
  ): Promise<OpenNativeAIPluginsConfigureResult>;
  validatePlugin(params: OpenNativeAIAgentValidatePluginParams): Promise<OpenNativeAIPluginsValidateResult>;
  describePlugin(params: OpenNativeAIAgentDescribePluginParams): Promise<OpenNativeAIPluginsDescribeResult>;
  setPluginEnabled(params: OpenNativeAIAgentSetPluginEnabledParams): Promise<OpenNativeAIPluginsSetEnabledResult>;
}

export const IPluginManagementService = createServiceDescriptor<IPluginManagementService>(
  ServiceChannels.PluginManagement,
);
