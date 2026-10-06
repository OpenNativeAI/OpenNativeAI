/**
 * Media Studio 存储布局：图像与视频各自独立的目录树 + 旧布局一次性迁移。
 *
 * 布局（rootDir = ~/.opennativeai/media-studio）：
 *   rootDir/image/{config.json, jobs.json, files/{jobId}.png}
 *   rootDir/video/{config.json, jobs.json, files/{jobId}.mp4}
 * 旧布局（rootDir/config.json、rootDir/jobs.json、rootDir/files/）在 Host 启动时
 * 迁移到新目录树：配置按模态拆分为两份独立文件；任务索引按 kind 分组落盘，
 * 产物文件搬移到各模态的 files/ 目录并更新记录中的绝对路径。
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { MediaStudioJobKind, MediaStudioProviderConfig } from "./mediaStudio.js";

export interface MediaStudioKindPaths {
  rootDir: string;
  configPath: string;
  jobsPath: string;
  filesDir: string;
}

export interface MediaStudioPaths {
  rootDir: string;
  kinds: Record<MediaStudioJobKind, MediaStudioKindPaths>;
}

const JOB_FILE_MODE = 0o600;

export function resolveMediaStudioPaths(rootDir: string): MediaStudioPaths {
  const kind = (name: MediaStudioJobKind): MediaStudioKindPaths => ({
    rootDir: join(rootDir, name),
    configPath: join(rootDir, name, "config.json"),
    jobsPath: join(rootDir, name, "jobs.json"),
    filesDir: join(rootDir, name, "files"),
  });
  return { rootDir, kinds: { image: kind("image"), video: kind("video") } };
}

export async function ensureKindDirs(paths: MediaStudioPaths): Promise<void> {
  await mkdir(paths.kinds.image.filesDir, { recursive: true });
  await mkdir(paths.kinds.video.filesDir, { recursive: true });
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), { mode: JOB_FILE_MODE });
}

interface LegacyFlatConfig {
  baseUrl: string;
  apiKey: string;
  imageModel: string;
  videoModel: string;
}

async function readLegacyFlatConfig(path: string): Promise<LegacyFlatConfig | null> {
  const parsed = await readJson(path);
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.baseUrl !== "string" || typeof record.apiKey !== "string") return null;
  return {
    baseUrl: record.baseUrl,
    apiKey: record.apiKey,
    imageModel: String(record.imageModel ?? ""),
    videoModel: String(record.videoModel ?? ""),
  };
}

/** 旧扁平 config.json → image/config.json + video/config.json（各模态独立文件）。 */
async function migrateLegacyConfig(paths: MediaStudioPaths): Promise<void> {
  const legacyPath = join(paths.rootDir, "config.json");
  const legacy = await readLegacyFlatConfig(legacyPath);
  if (!legacy) return;
  const toProvider = (singleModel: string): MediaStudioProviderConfig => ({
    baseUrl: legacy.baseUrl,
    apiKey: legacy.apiKey,
    model: singleModel,
    // 旧布局只有单个 model,迁移时把它包成单元素数组,新布局的下拉才能消费。
    models: singleModel ? [singleModel] : [],
  });
  const providers: Record<MediaStudioJobKind, MediaStudioProviderConfig> = {
    image: toProvider(legacy.imageModel),
    video: toProvider(legacy.videoModel),
  };
  for (const kindName of ["image", "video"] as const) {
    const kindPaths = paths.kinds[kindName];
    // 新布局已有该模态配置时以新文件为准，不覆盖。
    if ((await readJson(kindPaths.configPath)) === null) {
      await writeJson(kindPaths.configPath, providers[kindName]);
    }
  }
  await rm(legacyPath, { force: true });
}

interface LegacyJobRecord {
  id: string;
  kind: MediaStudioJobKind;
  prompt: string;
  size?: string;
  status: string;
  remoteTaskId?: string;
  filePath?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** 旧 jobs.json 按 kind 拆分到各模态目录；产物文件搬移到各模态 files/ 并更新路径。 */
async function migrateLegacyJobs(paths: MediaStudioPaths): Promise<void> {
  const legacyJobsPath = join(paths.rootDir, "jobs.json");
  const legacyFilesDir = join(paths.rootDir, "files");
  const parsed = await readJson(legacyJobsPath);
  if (!Array.isArray(parsed)) return;
  const records = parsed as LegacyJobRecord[];
  const groups: Record<MediaStudioJobKind, LegacyJobRecord[]> = { image: [], video: [] };
  for (const record of records) {
    const group = record.kind === "video" ? groups.video : groups.image;
    if (record.filePath?.startsWith(legacyFilesDir)) {
      const target = join(
        paths.kinds[record.kind === "video" ? "video" : "image"].filesDir,
        basename(record.filePath),
      );
      try {
        await mkdir(dirname(target), { recursive: true });
        await rename(record.filePath, target);
        record.filePath = target;
      } catch {
        // 文件可能已被外部删除/移动：保留原绝对路径，记录仍可按旧路径读取。
      }
    }
    group.push(record);
  }
  for (const kindName of ["image", "video"] as const) {
    const kindPaths = paths.kinds[kindName];
    const existing = await readJson(kindPaths.jobsPath);
    const merged = Array.isArray(existing) ? (existing as LegacyJobRecord[]) : [];
    const existingIds = new Set(merged.map((item) => item.id));
    const missing = groups[kindName].filter((item) => !existingIds.has(item.id));
    if (missing.length > 0 || merged.length > 0) {
      await writeJson(kindPaths.jobsPath, [...merged, ...missing]);
    }
  }
  await rm(legacyJobsPath, { force: true });
  // 旧 files 目录仅在搬空后移除；仍有残留（外部写入等）则保留。
  await rm(legacyFilesDir, { force: true }).catch(() => undefined);
}

/** Host 启动时执行一次；迁移幂等：旧文件不存在时为空操作。 */
export async function migrateLegacyMediaStudioLayout(paths: MediaStudioPaths): Promise<void> {
  await migrateLegacyConfig(paths);
  await migrateLegacyJobs(paths);
}
