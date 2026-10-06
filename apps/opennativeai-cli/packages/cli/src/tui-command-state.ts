import type {
  TuiEffortOption,
  TuiListMcpServers,
  TuiGetMainSessionId,
  TuiListWorkflowRuns,
  TuiReplayWorkflowRuns,
  TuiModelOption,
  TuiRecallPreviousInput,
  TuiSendInput,
  TuiSetMode,
  TuiSessionMetadata,
  TuiSubmitPrompt,
  TuiSubscribeSessionEvents,
} from "@opennativeai/tui";
import type { OpenNativeAIAppOptions } from "@opennativeai/bootstrap";
import type { CliModeState, CliPermissionMode, CliRuntimeMode } from "./cli-types.js";

export type TuiPromptHandler = TuiSubmitPrompt & {
  close?: () => Promise<void>;
  getSessionMetadata?: () => Promise<TuiSessionMetadata>;
  listEffortOptions?: () => Promise<readonly TuiEffortOption[]>;
  listMcpServers?: TuiListMcpServers;
  readSubagents?: import("@opennativeai/tui").TuiReadSubagents;
  readSubagentTranscript?: import("@opennativeai/tui").TuiReadSubagentTranscript;
  listWorkflowRuns?: TuiListWorkflowRuns;
  replayWorkflowRuns?: TuiReplayWorkflowRuns;
  getMainSessionId?: TuiGetMainSessionId;
  listModelOptions?: () => Promise<readonly TuiModelOption[]>;
  recallPreviousInput?: TuiRecallPreviousInput;
  sendInput?: TuiSendInput;
  setMode?: TuiSetMode;
  subscribeSessionEvents?: TuiSubscribeSessionEvents;
};

export const TUI_TITLE_GENERATION_CONFIG: NonNullable<
  NonNullable<OpenNativeAIAppOptions["runtimeConfig"]>["titleGeneration"]
> = {};

export const createCliModeState = (mode?: CliPermissionMode): CliModeState => ({
  current: mode,
  override: mode,
});

export const currentCliMode = (state: CliModeState): CliRuntimeMode =>
  state.current ?? state.override ?? "build";

/** The TUI's Plan entry projects the runtime's independent planning flag. */
export function readTuiMode(
  app: {
    getMode?: () => CliRuntimeMode;
    readonly runtime?: { getPlanEnabled?: () => boolean };
  },
  fallback: CliRuntimeMode,
): CliRuntimeMode {
  return app.runtime?.getPlanEnabled?.() ? "plan" : (app.getMode?.() ?? fallback);
}
