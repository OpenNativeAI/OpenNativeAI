/**
 * 设置页「日志查看器」的 main 进程 IPC 处理。
 * 提供列出日志文件和读取单个日志文件内容的能力。
 */
import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { shell } from "electron";
import { getAppConfigDir, getOpenNativeAIDataRootDir } from "@opennativeai/services/node";

/** 单个文件最大读取字节数（2 MB），超出则截断 */
const MAX_READ_BYTES = 2 * 1024 * 1024;

/**
 * 日志分类：
 * - app：应用运行日志（<dataRoot>/v2/logs），main/renderer 生命周期等诊断信息
 * - agent：Agent 会话轨迹（model-io），完整记录发给模型的请求与模型返回的响应
 */
export type LogCategory = "app" | "agent";

export interface LogFileEntry {
  name: string;
  sizeBytes: number;
  modifiedAt: number;
  category: LogCategory;
  /** agent 类别下区分来源子目录：debug（开发态）或 rollout（生产态） */
  subdir?: string;
  /** 文件所在绝对目录，仅用于 UI 展示来源，区分不同分类的物理目录 */
  dir: string;
  /** Agent 新结构下所属会话文件夹名，如 "2026-10-01T20-39_sess_6b9f1a0b" */
  sessionName?: string;
}

// Agent 会话日志（model-io）的两个来源子目录；同时作为读取时的路径白名单，防越界。
const AGENT_SUBDIRS: readonly string[] = ["debug", "rollout"];

function getAppLogDir(): string {
  return join(getAppConfigDir(), "logs");
}

// Agent 会话日志根目录：<dataRoot>/cli —— 与 CLI 默认 storage.dir(~/.opennativeai) 对齐，
// model-io 落盘在 cli/debug（开发态）或 cli/rollout（生产态）。
function getAgentLogRoot(): string {
  return join(getOpenNativeAIDataRootDir(), "cli");
}

async function scanDir(
  dir: string,
  category: LogCategory,
  subdir?: string,
): Promise<LogFileEntry[]> {
  const dirents = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!dirents) return [];

  const entries: LogFileEntry[] = [];
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue;
    // 仅展示 .log 和 .jsonl 文件
    if (!dirent.name.endsWith(".log") && !dirent.name.endsWith(".jsonl")) continue;
    const info = await stat(join(dir, dirent.name)).catch(() => null);
    if (!info) continue;
    entries.push({
      name: dirent.name,
      sizeBytes: info.size,
      modifiedAt: info.mtimeMs,
      category,
      subdir,
      dir,
    });
  }
  return entries;
}

/** 列出应用运行日志与 Agent 会话日志文件，按修改时间降序排列 */
export async function listLogFiles(): Promise<LogFileEntry[]> {
  const entries: LogFileEntry[] = [];

  // 应用运行日志
  entries.push(...(await scanDir(getAppLogDir(), "app")));

  // Agent 会话日志：新结构（sessions/ 文件夹）+ 旧结构（扁平 model-io-*.jsonl）
  const agentRoot = getAgentLogRoot();
  for (const subdir of AGENT_SUBDIRS) {
    const baseDir = join(agentRoot, subdir);
    // 新结构：扫描 sessions/{sessionFolder}/turn-*.jsonl
    const sessionsDir = join(baseDir, "sessions");
    entries.push(...(await scanSessionFolders(sessionsDir, subdir)));
    // 旧结构兼容：扫描扁平 model-io-*.jsonl
    entries.push(...(await scanDir(baseDir, "agent", subdir)));
  }

  entries.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return entries;
}

/** 扫描新结构下的会话文件夹，返回 turn 文件列表 */
async function scanSessionFolders(sessionsDir: string, subdir: string): Promise<LogFileEntry[]> {
  const dirents = await readdir(sessionsDir, { withFileTypes: true }).catch(() => null);
  if (!dirents) return [];

  const entries: LogFileEntry[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const sessionName = dirent.name;
    const turnDir = join(sessionsDir, sessionName);
    const turnFiles = await readdir(turnDir, { withFileTypes: true }).catch(() => null);
    if (!turnFiles) continue;
    for (const tf of turnFiles) {
      if (!tf.isFile() || !tf.name.endsWith(".jsonl")) continue;
      const info = await stat(join(turnDir, tf.name)).catch(() => null);
      if (!info) continue;
      entries.push({
        name: tf.name,
        sizeBytes: info.size,
        modifiedAt: info.mtimeMs,
        category: "agent",
        subdir,
        dir: turnDir,
        sessionName,
      });
    }
  }
  return entries;
}

/** 依据分类、来源子目录和会话文件夹解析日志文件绝对路径；非法或越界返回 null */
function resolveLogFilePath(
  fileName: string,
  category: LogCategory,
  subdir?: string,
  sessionName?: string,
): string | null {
  // 安全校验：防止路径遍历
  if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    return null;
  }
  if (category === "agent") {
    // subdir 必须命中白名单，避免任意目录读取
    if (!subdir || !AGENT_SUBDIRS.includes(subdir)) return null;
    // 新结构：带 sessionName 时从 sessions/ 文件夹读取
    if (sessionName) {
      if (sessionName.includes("..") || sessionName.includes("/") || sessionName.includes("\\")) {
        return null;
      }
      return join(getAgentLogRoot(), subdir, "sessions", sessionName, fileName);
    }
    // 旧结构兼容：扁平文件
    return join(getAgentLogRoot(), subdir, fileName);
  }
  return join(getAppLogDir(), fileName);
}

/** 读取指定日志文件内容；超过 MAX_READ_BYTES 时截断 */
export async function readLogFileContent(
  fileName: string,
  category: LogCategory = "app",
  subdir?: string,
  sessionName?: string,
): Promise<{ content: string; truncated: boolean } | null> {
  const filePath = resolveLogFilePath(fileName, category, subdir, sessionName);
  if (!filePath) return null;

  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return null;

  const buffer = await readFile(filePath).catch(() => null);
  if (!buffer) return null;

  if (buffer.byteLength <= MAX_READ_BYTES) {
    return { content: buffer.toString("utf-8"), truncated: false };
  }
  return {
    content: buffer.subarray(0, MAX_READ_BYTES).toString("utf-8"),
    truncated: true,
  };
}

/**
 * 在系统文件管理器（访达 / 资源管理器）中定位日志文件。
 * 复用 resolveLogFilePath 的分类白名单，防止越界访问任意路径。
 */
export async function revealLogFile(
  fileName: string,
  category: LogCategory = "app",
  subdir?: string,
  sessionName?: string,
): Promise<boolean> {
  const filePath = resolveLogFilePath(fileName, category, subdir, sessionName);
  if (!filePath) return false;
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return false;
  shell.showItemInFolder(filePath);
  return true;
}
