import type { IDisposable } from "@opennativeai/rpc";
import type { IOpenNativeAIAgentService } from "@opennativeai/services";
import type { ProcessResourceRuntimeSurface } from "@opennativeai/shared";
import { HostResponseTypes } from "@opennativeai/shared";

interface RegisterHostMcpTelemetryOptions {
  agentService: Pick<IOpenNativeAIAgentService, "onDynamicMcpTelemetry">;
  postMessage(message: unknown): void;
  runtimeSurface: ProcessResourceRuntimeSurface;
}

export function registerHostMcpTelemetry(options: RegisterHostMcpTelemetryOptions): IDisposable {
  return options.agentService.onDynamicMcpTelemetry()((event) => {
    try {
      options.postMessage({
        type: HostResponseTypes.McpTelemetry,
        runtimeSurface: options.runtimeSurface,
        event,
      });
    } catch {
      // main 已退出或 IPC 不可用时只丢当前遥测，不影响 MCP 生命周期。
    }
  });
}
