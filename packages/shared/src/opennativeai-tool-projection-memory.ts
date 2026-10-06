import type { OpenNativeAIStreamingToolInputState } from "./streaming-tool-input-preview.js";

export interface OpenNativeAIToolProjectionMemory {
  completeToolInputById?: Map<string, unknown>;
  streamingToolInputById?: Map<string, OpenNativeAIStreamingToolInputState>;
  toolNameById?: Map<string, string>;
}

export interface OpenNativeAIToolProjectionMetadata {
  hasInput: boolean;
  input?: unknown;
  toolName?: string;
}

export function createOpenNativeAIToolProjectionMemory(): OpenNativeAIToolProjectionMemory {
  return {
    completeToolInputById: new Map<string, unknown>(),
    streamingToolInputById: new Map<string, OpenNativeAIStreamingToolInputState>(),
    toolNameById: new Map<string, string>(),
  };
}

export function ensureOpenNativeAIToolProjectionMemory(
  memory: OpenNativeAIToolProjectionMemory,
): OpenNativeAIToolProjectionMemory {
  memory.completeToolInputById ??= new Map<string, unknown>();
  memory.streamingToolInputById ??= new Map<string, OpenNativeAIStreamingToolInputState>();
  memory.toolNameById ??= new Map<string, string>();
  return memory;
}

export function resolveOpenNativeAIToolProjectionMetadata(
  payload: Record<string, unknown>,
  toolId: string,
  memory: OpenNativeAIToolProjectionMemory,
): OpenNativeAIToolProjectionMetadata {
  const toolName = readNonEmptyString(payload.toolName) ?? memory.toolNameById?.get(toolId);
  if (toolName) {
    memory.toolNameById?.set(toolId, toolName);
  }

  if ("input" in payload) {
    return {
      hasInput: payload.input !== undefined,
      input: payload.input,
      toolName,
    };
  }

  if (memory.completeToolInputById?.has(toolId)) {
    return {
      hasInput: true,
      input: memory.completeToolInputById.get(toolId),
      toolName,
    };
  }

  return {
    hasInput: false,
    toolName,
  };
}

export function finalizeOpenNativeAIToolProjectionInput(
  toolId: string,
  input: unknown,
  memory: OpenNativeAIToolProjectionMemory,
): void {
  memory.completeToolInputById ??= new Map<string, unknown>();
  memory.completeToolInputById.set(toolId, input);
  const streamingState = memory.streamingToolInputById?.get(toolId);
  if (streamingState) {
    streamingState.lastPreviewRawInputLength = streamingState.rawInput.length;
    streamingState.rawInput = "";
  }
}

export function forgetOpenNativeAIToolProjectionMetadata(
  toolId: string,
  memory: OpenNativeAIToolProjectionMemory,
): void {
  memory.completeToolInputById?.delete(toolId);
  memory.streamingToolInputById?.delete(toolId);
  memory.toolNameById?.delete(toolId);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
