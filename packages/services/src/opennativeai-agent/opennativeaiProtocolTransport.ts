import type { Event, IDisposable } from "@opennativeai/rpc";
import type { OpenNativeAIProtocolMessage } from "@opennativeai/shared";

export type OpenNativeAIProtocolTransportKind = "stdio" | "websocket" | "memory";

export interface OpenNativeAIProtocolTransportClosedEvent {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  reason?: string;
}

export interface OpenNativeAIProtocolTransport extends IDisposable {
  readonly kind: OpenNativeAIProtocolTransportKind;
  readonly onMessage: Event<OpenNativeAIProtocolMessage>;
  readonly onClose: Event<OpenNativeAIProtocolTransportClosedEvent>;
  send(message: OpenNativeAIProtocolMessage): Promise<void>;
  disposeAndWait?(): Promise<void>;
}
