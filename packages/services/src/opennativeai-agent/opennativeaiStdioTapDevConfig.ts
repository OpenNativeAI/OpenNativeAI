import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OpenNativeAIStdioTapDevState } from "@opennativeai/shared";
import { getAppConfigDir } from "#src/paths.js";
import { isEffectiveDevelopmentNodeEnv } from "#src/runtime-tools/nodeEnv.js";

interface OpenNativeAIStdioTapStateFile {
  enabled?: boolean;
}

function isOpenNativeAIStdioTapDevVisible(): boolean {
  return isEffectiveDevelopmentNodeEnv();
}

function getOpenNativeAIStdioTapDevDir(): string {
  return join(getAppConfigDir(), "dev");
}

export function getOpenNativeAIStdioTapDevLogDir(): string {
  return join(getOpenNativeAIStdioTapDevDir(), "stdio-traffic");
}

function getOpenNativeAIStdioTapDevStatePath(): string {
  return join(getOpenNativeAIStdioTapDevDir(), "opennativeai-stdio-tap.json");
}

function readStateFile(path: string): OpenNativeAIStdioTapStateFile {
  if (!existsSync(path)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as OpenNativeAIStdioTapStateFile) : {};
  } catch {
    return {};
  }
}

export function readOpenNativeAIStdioTapDevState(): OpenNativeAIStdioTapDevState {
  const visible = isOpenNativeAIStdioTapDevVisible();
  const statePath = getOpenNativeAIStdioTapDevStatePath();
  const fileState = readStateFile(statePath);
  return {
    enabled: visible && fileState.enabled === true,
    visible,
    logDir: getOpenNativeAIStdioTapDevLogDir(),
    statePath,
  };
}

export function setOpenNativeAIStdioTapDevEnabled(enabled: boolean): OpenNativeAIStdioTapDevState {
  const visible = isOpenNativeAIStdioTapDevVisible();
  const statePath = getOpenNativeAIStdioTapDevStatePath();
  mkdirSync(getOpenNativeAIStdioTapDevDir(), { recursive: true });
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        // 开发态 stdio 抓包是高频原始协议帧，只能通过显式开关写旁路文件，避免误进生产日志。
        enabled: visible && enabled,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return readOpenNativeAIStdioTapDevState();
}
