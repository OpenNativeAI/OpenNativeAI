import type { TuiReadClipboardImage, TuiWriteClipboardText } from "@opennativeai/tui";
import type { UiLocale } from "@opennativeai/i18n";
import type { Logger } from "@opennativeai/contracts";
import type {
  createManagedCdpBrowserRuntime,
  ManagedCdpBrowserRuntimeOptions,
} from "@opennativeai/adapters/browser";
import type {
  createModelAdapter,
  createOpenNativeAIApp,
  CreateModelAdapterOptions,
  configureCodingPlanApiKey,
  ConfigureCodingPlanApiKeyOptions,
  inspectOpenNativeAISkill,
  inspectWorkspaceHookTrust,
  grantWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
  inspectOpenNativeAICustomCommand,
  InspectOpenNativeAICustomCommandOptions,
  InspectOpenNativeAISkillOptions,
  loginOpenNativeAICli,
  loginBigmodelCodingPlan,
  LoginBigmodelCodingPlanOptions,
  LoginOpenNativeAICliOptions,
  listOpenNativeAICustomCommands,
  ListOpenNativeAICustomCommandsOptions,
  loadOpenNativeAICustomCommand,
  listOpenNativeAISessions,
  listOpenNativeAISkills,
  ListOpenNativeAISessionsOptions,
  ListOpenNativeAISkillsOptions,
  logoutOpenNativeAICli,
  LogoutOpenNativeAICliOptions,
  resolveLatestSession,
  ResolveLatestSessionOptions,
  RunOpenNativeAIProtocolAgentOptions,
  prepareOpenNativeAITelemetryEnv,
  startProcessProviderRegistryRuntime,
  shutdownOpenNativeAITelemetry,
  OpenNativeAIAppOptions,
} from "@opennativeai/bootstrap";
import type { CliEnv, DotenvLoadResult, LoadCliDotenvOptions } from "./env.js";
import type { PluginsCommandOverrides } from "./plugins-command.js";
import type { CliShutdownProcess } from "./shutdown.js";
import type { resolveWorkspaceGitBranch } from "./tui-workspace-git.js";

export type BootstrapModule = typeof import("@opennativeai/bootstrap");

export interface RunDependencies extends PluginsCommandOverrides {
  protocolLifecycle?: RunOpenNativeAIProtocolAgentOptions["lifecycle"];
  protocolInput?: NodeJS.ReadableStream;
  createManagedCdpBrowserRuntime?: (
    options?: ManagedCdpBrowserRuntimeOptions,
  ) => ReturnType<typeof createManagedCdpBrowserRuntime>;
  createModelAdapter?: (
    options?: CreateModelAdapterOptions,
  ) => ReturnType<typeof createModelAdapter>;
  createOpenNativeAIApp?: (
    options?: OpenNativeAIAppOptions,
  ) => Awaited<ReturnType<typeof createOpenNativeAIApp>> | ReturnType<typeof createOpenNativeAIApp>;
  /**
   * Session-event shaper for --output-format stream-json. Defaults to the
   * bootstrap module's, which is also what the protocol server uses; injectable
   * so a caller that supplies its own `createOpenNativeAIApp` (tests, embedders) can
   * still stream, since the bootstrap module is not loaded on that path.
   */
  mapSessionEvent?: BootstrapModule["mapSessionEvent"];
  cwd?: () => string;
  env?: CliEnv;
  inspectSkill?: (options: InspectOpenNativeAISkillOptions) => ReturnType<typeof inspectOpenNativeAISkill>;
  inspectWorkspaceHookTrust?: typeof inspectWorkspaceHookTrust;
  grantWorkspaceHookTrust?: typeof grantWorkspaceHookTrust;
  revokeWorkspaceHookTrustCli?: typeof revokeWorkspaceHookTrustCli;
  inspectCustomCommand?: (
    options: InspectOpenNativeAICustomCommandOptions,
  ) => ReturnType<typeof inspectOpenNativeAICustomCommand>;
  loginOpenNativeAICli?: (options?: LoginOpenNativeAICliOptions) => ReturnType<typeof loginOpenNativeAICli>;
  loginBigmodelCodingPlan?: (
    options?: LoginBigmodelCodingPlanOptions,
  ) => ReturnType<typeof loginBigmodelCodingPlan>;
  configureCodingPlanApiKey?: (
    options: ConfigureCodingPlanApiKeyOptions,
  ) => ReturnType<typeof configureCodingPlanApiKey>;
  loadDotenv?: (options?: LoadCliDotenvOptions) => DotenvLoadResult;
  prepareOpenNativeAITelemetryEnv?: typeof prepareOpenNativeAITelemetryEnv;
  projectConfigPath?: string;
  listSessions?: (options: ListOpenNativeAISessionsOptions) => ReturnType<typeof listOpenNativeAISessions>;
  listCustomCommands?: (
    options: ListOpenNativeAICustomCommandsOptions,
  ) => ReturnType<typeof listOpenNativeAICustomCommands>;
  loadCustomCommand?: (
    options: InspectOpenNativeAICustomCommandOptions,
  ) => ReturnType<typeof loadOpenNativeAICustomCommand>;
  // headless slash 路由要和 app facade 的保留名 gate 用同一个判据；默认取 bootstrap 的，
  // 注入点只为让单测不必拉起整个 bootstrap 模块。见 prompt-command.ts。
  isReservedSlashCommandName?: BootstrapModule["isReservedOpenNativeAISlashCommandName"];
  listSkills?: (options: ListOpenNativeAISkillsOptions) => ReturnType<typeof listOpenNativeAISkills>;
  logger?: Logger;
  readClipboardImage?: TuiReadClipboardImage;
  writeClipboardText?: TuiWriteClipboardText;
  resolveLatestSession?: (
    options: ResolveLatestSessionOptions,
  ) => ReturnType<typeof resolveLatestSession>;
  resolveWorkspaceGitBranch?: typeof resolveWorkspaceGitBranch;
  logoutOpenNativeAICli?: (options?: LogoutOpenNativeAICliOptions) => ReturnType<typeof logoutOpenNativeAICli>;
  runOpenNativeAIProtocolAgent?: (options?: RunOpenNativeAIProtocolAgentOptions) => Promise<void>;
  runTui?: typeof import("@opennativeai/tui").runTui;
  skipUserConfig?: boolean;
  userConfigPath?: string;
  exitProcess?: (code: number) => void;
  shutdownCleanupTimeoutMs?: number;
  shutdownProcess?: CliShutdownProcess;
  startProcessProviderRegistryRuntime?: typeof startProcessProviderRegistryRuntime;
  shutdownOpenNativeAITelemetry?: typeof shutdownOpenNativeAITelemetry;
}

export type CliPermissionMode = "build" | "plan" | "edit" | "yolo";
export type CliRuntimeMode = CliPermissionMode | "auto";

export interface CliModeState {
  current?: CliRuntimeMode;
  override?: CliPermissionMode;
}

export interface CliTargetRequest {
  objective: string;
  replaceExisting: boolean;
}

export type ModeCapableApp = Awaited<ReturnType<typeof createOpenNativeAIApp>> & {
  getMode?: () => CliRuntimeMode;
  setLocale?: (locale: UiLocale) => Promise<{ locale: "en-US" | "zh-CN" }>;
  setMode?: (mode: CliRuntimeMode) => Promise<{ mode: CliRuntimeMode }>;
};

export interface CliResumeRequest {
  continueSession: boolean;
  resumeSessionId?: string;
}
