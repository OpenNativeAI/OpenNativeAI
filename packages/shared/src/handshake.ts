export interface HelloMessage {
  type: "opennativeai-hello";
  version: string;
  platform: string;
  arch: string;
  pid: number;
}

export interface HelloAckMessage {
  type: "opennativeai-hello-ack";
  version: string;
  clientId: string;
}
