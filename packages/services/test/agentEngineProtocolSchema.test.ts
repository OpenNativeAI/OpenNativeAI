// 会话引擎换芯（docs/specs/localagent-protocol-adapter.md §4）协议 schema 单测：
// create/resume params 与 v4 createSession payload 接受 "lite"、拒绝非法值、缺席即不写。
import assert from "node:assert/strict";
import test from "node:test";
import {
  opennativeaiAgentEngineSchema,
  opennativeaiSessionCreateParamsSchema,
  opennativeaiSessionResumeParamsSchema,
} from "@opennativeai/shared";
import { commandPayloadSchemas } from "@opennativeai/shared/opennativeai-protocol-v4";

const workspace = { workspaceKey: "wk", workspacePath: "/example/workspace" };

test("session/create accepts agentEngine lite", () => {
  const parsed = opennativeaiSessionCreateParamsSchema.parse({
    workspace,
    agentEngine: "lite",
  });
  assert.equal(parsed.agentEngine, "lite");
});

test("session/create keeps agentEngine absent as absent (fail-closed default)", () => {
  const parsed = opennativeaiSessionCreateParamsSchema.parse({ workspace });
  assert.ok(!("agentEngine" in parsed));
});

test("session/create rejects invalid agentEngine values", () => {
  assert.throws(() =>
    opennativeaiSessionCreateParamsSchema.parse({
      workspace,
      agentEngine: "ultra",
    }),
  );
});

test("session/resume accepts agentEngine lite", () => {
  const parsed = opennativeaiSessionResumeParamsSchema.parse({
    sessionId: "session-1",
    agentEngine: "lite",
  });
  assert.equal(parsed.agentEngine, "lite");
});

test("agentEngine enum only allows default and lite", () => {
  assert.equal(opennativeaiAgentEngineSchema.parse("default"), "default");
  assert.equal(opennativeaiAgentEngineSchema.parse("lite"), "lite");
  assert.throws(() => opennativeaiAgentEngineSchema.parse("localagent"));
});

test("v4 createSession payload accepts additive agentEngine", () => {
  const parsed = commandPayloadSchemas.createSession.parse({
    workspaceId: "/example/workspace",
    agentEngine: "lite",
  });
  assert.equal(parsed.agentEngine, "lite");
});
