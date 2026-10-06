// Bootstrap public API surface.

export * from "./app/create-app.js";
export type {
  ListOpenNativeAISessionsOptions,
  PromptInput,
  ResolveLatestSessionOptions,
  ResumeOptions,
  RunOpenNativeAIProtocolAgentOptions,
  SendInputOptions,
  SendInputResult,
  SetLocaleResult,
  SteerTurnOptions,
  SubmitPromptOptions,
  UserPromptInput,
  OpenNativeAIApp,
  OpenNativeAIAppOptions,
  OpenNativeAIModelOption,
} from "./app/types.js";
export * from "./auth-login.js";
export {
  inspectOpenNativeAICustomCommand,
  listOpenNativeAICustomCommands,
  loadOpenNativeAICustomCommand,
} from "./custom-commands.js";
export type {
  InspectOpenNativeAICustomCommandOptions,
  ListOpenNativeAICustomCommandsOptions,
  OpenNativeAICustomCommandInspection,
} from "./custom-commands.js";
export { createModelAdapter } from "./model-factory.js";
export type { CreateModelAdapterOptions } from "./model-factory.js";
export { startProcessProviderRegistryRuntime } from "./app/process-provider-registry-runtime.js";
export type { ProcessProviderRegistryRuntimeOptions } from "./app/process-provider-registry-runtime.js";
export {
  addOpenNativeAIPluginMarketplace,
  getOpenNativeAIPluginsOverview,
  installOpenNativeAIMarketplacePlugin,
  listOpenNativeAIPlugins,
  removeOpenNativeAIPluginMarketplace,
  resolveOpenNativeAIPlugins,
  setOpenNativeAIPluginEnabled,
  uninstallOpenNativeAIMarketplacePlugin,
  updateOpenNativeAIMarketplacePlugin,
  updateOpenNativeAIPluginMarketplace,
  validateOpenNativeAIPluginPath,
} from "./plugins.js";
export type {
  AddOpenNativeAIMarketplaceOptions,
  InstallOpenNativeAIMarketplacePluginOptions,
  ListOpenNativeAIPluginsOptions,
  RemoveOpenNativeAIMarketplaceOptions,
  ResolveOpenNativeAIPluginsOptions,
  SetOpenNativeAIPluginEnabledOptions,
  SetOpenNativeAIPluginEnabledResult,
  UninstallOpenNativeAIMarketplacePluginOptions,
  UpdateOpenNativeAIMarketplaceOptions,
  UpdateOpenNativeAIMarketplacePluginOptions,
  ValidateOpenNativeAIPluginPathOptions,
  OpenNativeAIAvailablePluginData,
  OpenNativeAIInstalledPluginData,
  OpenNativeAIMarketplaceSummaryData,
  OpenNativeAIMarketplaceUpdateData,
  OpenNativeAIPluginInstallData,
  OpenNativeAIPluginUpdateData,
  OpenNativeAIPluginsOverviewData,
} from "./plugins.js";
export { runOpenNativeAIProtocolAgent } from "./opennativeai-protocol-entrypoint.js";
// Exposed for the CLI's --output-format stream-json: it needs the same event
// shape the protocol server emits, rather than inventing a second one.
export { mapSessionEvent } from "./opennativeai-protocol/session-mapper.js";
export { prepareOpenNativeAITelemetryEnv, shutdownOpenNativeAITelemetry } from "./telemetry-bootstrap.js";
export type { SessionTranscriptMessage, SessionTranscriptPart } from "./session-transcript.js";
export { listOpenNativeAISessions, resolveLatestSession } from "./sessions.js";
export { inspectOpenNativeAISkill, listOpenNativeAISkills } from "./skills.js";
export type {
  InspectOpenNativeAISkillOptions,
  ListOpenNativeAISkillsOptions,
  OpenNativeAISkillInspection,
} from "./skills.js";
// Exposed for the CLI's headless slash routing: it must decide "is this a real
// custom command?" with the *same* reserved-name gate the app facade's
// customCommandPromptResolver applies, or the two disagree and a reserved name
// reaches the model as literal prompt text. See prompt-command.ts.
export { isReservedOpenNativeAISlashCommandName } from "./slash-command-surface.js";
export {
  grantWorkspaceHookTrust,
  inspectWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
} from "./workspace-hook-trust-cli.js";
export type {
  WorkspaceHookTrustCliItem,
  WorkspaceHookTrustCliStatus,
  WorkspaceHookTrustCliTarget,
} from "./workspace-hook-trust-cli.js";
