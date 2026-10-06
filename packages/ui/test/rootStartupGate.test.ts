// 开源项目发布形态：默认不应在启动时强制打开 WelcomeScreen 登录入口，
// 否则用户首次安装应用就会被锁在登录页。登录仍由 manual-login /
// provider-request / session-expired / logout-provider-required 等
// 主动/必要场景按需触发，不在此处阻塞启动。
import assert from "node:assert/strict";
import test from "node:test";
import { shouldEnableProviderAvailabilityLoginEntryGuard } from "../src/lib/rootStartupGate.js";

test("rootStartupGate: provider availability login entry guard is disabled by default", () => {
  assert.equal(shouldEnableProviderAvailabilityLoginEntryGuard(), false);
});
