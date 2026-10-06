const OPENNATIVEAI_PROCESS_PREFIX = "opennativeai";
const MAX_PROCESS_NAME_SEGMENT_LENGTH = 24;

function sanitizeProcessNameSegment(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_PROCESS_NAME_SEGMENT_LENGTH);
}

function joinOpenNativeAIProcessName(...segments: Array<string | null | undefined>): string {
  const sanitizedSegments = segments
    .map((segment) => sanitizeProcessNameSegment(segment))
    .filter((segment): segment is string => Boolean(segment));
  return [OPENNATIVEAI_PROCESS_PREFIX, ...sanitizedSegments].join("-");
}

function pickWorkspaceTag(workspacePath: string | null | undefined): string | undefined {
  const trimmedPath = workspacePath?.trim();
  if (!trimmedPath) {
    return undefined;
  }

  const parts = trimmedPath.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? trimmedPath;
}

export function formatOpenNativeAIMainProcessName(): string {
  return joinOpenNativeAIProcessName("main");
}

export function formatOpenNativeAIGpuProcessName(): string {
  return joinOpenNativeAIProcessName("gpu");
}

export function formatOpenNativeAIHostProcessName(label?: string): string {
  return joinOpenNativeAIProcessName("host", label);
}

export function formatOpenNativeAIRendererProcessName(windowTitle?: string): string {
  const normalizedTitle = windowTitle?.trim();
  if (!normalizedTitle || normalizedTitle === "OpenNativeAI") {
    return joinOpenNativeAIProcessName("renderer", "main");
  }

  if (normalizedTitle === "Resource Manager") {
    return joinOpenNativeAIProcessName("renderer", "resource-manager");
  }

  const remoteWindowPrefix = "OpenNativeAI - ";
  if (normalizedTitle.startsWith(remoteWindowPrefix)) {
    return joinOpenNativeAIProcessName(
      "renderer",
      "remote",
      normalizedTitle.slice(remoteWindowPrefix.length),
    );
  }

  return joinOpenNativeAIProcessName("renderer", normalizedTitle);
}

export function formatOpenNativeAIAgentProcessName(provider: string, workspacePath?: string): string {
  return joinOpenNativeAIProcessName("agent", provider, pickWorkspaceTag(workspacePath));
}

export function formatOpenNativeAIUtilityProcessName(name?: string, type = "utility"): string {
  return joinOpenNativeAIProcessName(type, name);
}
