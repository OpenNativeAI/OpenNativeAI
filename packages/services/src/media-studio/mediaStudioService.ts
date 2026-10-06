/* eslint-disable max-lines -- media-studio 服务承载图像/视频配置、t2i/i2i 多协议分发、远端轮询与 host 重启恢复，单文件保留便于跨状态推演。 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createUuid } from "@opennativeai/shared";
import {
  type IMediaStudioService,
  type MediaStudioConfig,
  type MediaStudioJobKind,
  type MediaStudioJobSummary,
  type MediaStudioJobStatus,
  type MediaStudioProviderConfig,
} from "./mediaStudio.js";
import {
  readProviderConfig as readKindProviderConfig,
  toProviderView,
  writeProviderConfig,
} from "./mediaStudioConfigStore.js";
import { getOpenNativeAIDataRootDir } from "../paths.js";
import {
  ensureKindDirs,
  migrateLegacyMediaStudioLayout,
  resolveMediaStudioPaths,
} from "./mediaStudioLayout.js";

/** 视频异步任务轮询间隔与超时上限（超时记 failed，不自动重试以免重复计费）。 */
const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_TIMEOUT_MS = 30 * 60_000;

const JOB_KINDS: readonly MediaStudioJobKind[] = ["image", "video"];

interface MediaStudioJobRecord {
  id: string;
  kind: MediaStudioJobKind;
  prompt: string;
  /** 用户在生成页下拉里选的模型 ID；落盘便于任务列表回显与 Host 重启后复用。 */
  model?: string;
  size?: string;
  status: MediaStudioJobStatus;
  remoteTaskId?: string;
  filePath?: string;
  error?: string;
  /** 参考图标记与来源（不存图本身）：hasReferenceImage=true 表示本次生成用了 image_url；
   *  referenceFromJobId 仅在画廊复用时有值，便于 UI 渲染来源关联。 */
  hasReferenceImage?: boolean;
  referenceFromJobId?: string;
  createdAt: number;
  updatedAt: number;
}

const DATA_URL_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

/** 独立存储根：与 cli/、v2/ 平级但完全隔离，会话链路不感知该目录。 */
function getMediaStudioRootDir(): string {
  return join(getOpenNativeAIDataRootDir(), "media-studio");
}

function toSummary(record: MediaStudioJobRecord): MediaStudioJobSummary {
  return {
    id: record.id,
    kind: record.kind,
    prompt: record.prompt,
    model: record.model,
    size: record.size,
    status: record.status,
    error: record.error,
    hasReferenceImage: record.hasReferenceImage,
    referenceFromJobId: record.referenceFromJobId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createMediaStudioService(): IMediaStudioService {
  const paths = resolveMediaStudioPaths(getMediaStudioRootDir());

  // 任务索引按模态独立缓存与落盘（image/jobs.json、video/jobs.json）。
  const jobsByKind: Record<MediaStudioJobKind, MediaStudioJobRecord[] | null> = {
    image: null,
    video: null,
  };
  // 首帧并发防护：Host 重启恢复的 IIFE 与 Renderer 首次 listJobs 可能同时触发 loadJobs。
  // 若各自独立 readFile+JSON.parse，会得到两份不同的数组实例并互相覆盖缓存，
  // 导致 updateJob 写入的状态被另一份陈旧副本冲掉。按模态缓存 in-flight Promise 做单飞，
  // 保证每个模态全生命周期只有一个 jobs 数组实例，读写路径唯一。
  const jobsLoadPromiseByKind: Record<MediaStudioJobKind, Promise<MediaStudioJobRecord[]> | null> =
    { image: null, video: null };
  const inflightJobIds = new Set<string>();

  // 旧布局（扁平 config.json / jobs.json / files/）迁移必须先于一切读写；幂等。
  const ready = migrateLegacyMediaStudioLayout(paths);

  async function loadJobs(kind: MediaStudioJobKind): Promise<MediaStudioJobRecord[]> {
    const cached = jobsByKind[kind];
    if (cached) return cached;
    let promise = jobsLoadPromiseByKind[kind];
    if (!promise) {
      promise = (async () => {
        let records: MediaStudioJobRecord[] = [];
        try {
          const raw = await readFile(paths.kinds[kind].jobsPath, "utf8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) records = parsed as MediaStudioJobRecord[];
        } catch {
          // 无索引文件 = 空任务列表。
        }
        jobsByKind[kind] = records;
        return records;
      })();
      jobsLoadPromiseByKind[kind] = promise;
    }
    return promise;
  }

  async function persistJobs(kind: MediaStudioJobKind): Promise<void> {
    await mkdir(paths.kinds[kind].rootDir, { recursive: true });
    await writeFile(paths.kinds[kind].jobsPath, JSON.stringify(jobsByKind[kind] ?? [], null, 2), {
      mode: 0o600,
    });
  }

  /** 跨模态定位任务记录；kind 决定其索引文件与配置来源。 */
  async function locateJob(
    jobId: string,
  ): Promise<{ kind: MediaStudioJobKind; record: MediaStudioJobRecord } | null> {
    for (const kind of JOB_KINDS) {
      const record = (await loadJobs(kind)).find((job) => job.id === jobId);
      if (record) return { kind, record };
    }
    return null;
  }

  async function updateJob(
    jobId: string,
    patch: Partial<MediaStudioJobRecord>,
  ): Promise<MediaStudioJobRecord | null> {
    const found = await locateJob(jobId);
    if (!found) return null;
    Object.assign(found.record, patch, { updatedAt: Date.now() });
    await persistJobs(found.kind);
    return found.record;
  }

  async function readProviderConfig(
    kind: MediaStudioJobKind,
  ): Promise<MediaStudioProviderConfig | null> {
    // 读写原语拆到 mediaStudioConfigStore；这里保留薄包装避免逐调用点传 paths。
    return readKindProviderConfig(paths, kind);
  }

  async function fetchAuth(url: string, apiKey: string, init?: RequestInit): Promise<Response> {
    // 注意：仅注入 Authorization；如果 init.headers 已含 Content-Type（如 multipart 由 fetch 自动生成 boundary）则保留调用方声明。
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      ...(init?.headers as Record<string, string> | undefined),
    };
    return fetch(url, { ...init, headers });
  }

  async function fetchJson(url: string, apiKey: string, init?: RequestInit) {
    const response = await fetchAuth(url, apiKey, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  async function saveJobFile(
    kind: MediaStudioJobKind,
    jobId: string,
    extension: string,
    buffer: Buffer,
  ): Promise<string> {
    const filesDir = paths.kinds[kind].filesDir;
    await mkdir(filesDir, { recursive: true });
    const filePath = `${filesDir}/${jobId}${extension}`;
    await writeFile(filePath, buffer);
    return filePath;
  }

  async function downloadBuffer(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async function runImageJob(
    jobId: string,
    provider: MediaStudioProviderConfig,
    model: string,
    referenceImage: { dataUrl: string } | undefined,
  ): Promise<void> {
    const found = await locateJob(jobId);
    if (!found) return;
    const prompt = found.record.prompt;
    const size = found.record.size;
    // i2i 协议兜底：中转站 / 模型对「带参考图」的协议差异较大，
    // 走 provider.i2iMode；未配置则按 OpenAI / Azure gpt-image 标准（edits-multipart）。
    // 仅 t2i 一律走 /images/generations JSON。
    const payload = referenceImage
      ? await postImageWithReference(provider, model, prompt, size, referenceImage.dataUrl)
      : await fetchJson(`${provider.baseUrl}/images/generations`, provider.apiKey, {
          method: "POST",
          body: JSON.stringify({
            model,
            prompt,
            ...(size ? { size } : {}),
          }),
        });
    const first = Array.isArray(payload.data) ? (payload.data[0] as Record<string, unknown>) : null;
    const b64 = typeof first?.b64_json === "string" ? first.b64_json : null;
    const remoteUrl = typeof first?.url === "string" ? first.url : null;
    const buffer = b64
      ? Buffer.from(b64, "base64")
      : remoteUrl
        ? await downloadBuffer(remoteUrl)
        : null;
    if (!buffer) throw new Error("provider response has no image payload");
    const filePath = await saveJobFile("image", jobId, ".png", buffer);
    await updateJob(jobId, { status: "succeeded", filePath });
  }

  /**
   * 根据 provider.i2iMode 分流到不同的图生图协议实现；
   * 默认走 OpenAI / Azure gpt-image 标准的 edits-multipart。
   */
  async function postImageWithReference(
    provider: MediaStudioProviderConfig,
    model: string,
    prompt: string,
    size: string | undefined,
    referenceDataUrl: string,
  ): Promise<Record<string, unknown>> {
    const mode = provider.i2iMode ?? "edits-multipart";
    if (mode === "image-url-json") {
      return fetchJson(`${provider.baseUrl}/images/generations`, provider.apiKey, {
        method: "POST",
        body: JSON.stringify({
          model,
          prompt,
          image_url: referenceDataUrl,
          ...(size ? { size } : {}),
        }),
      });
    }
    if (mode === "input-images-json") {
      return fetchJson(`${provider.baseUrl}/images/generations`, provider.apiKey, {
        method: "POST",
        body: JSON.stringify({
          model,
          prompt,
          input_images: [referenceDataUrl],
          ...(size ? { size } : {}),
        }),
      });
    }
    return postImageEdit(provider, model, prompt, size, referenceDataUrl);
  }

  /**
   * POST /images/edits（multipart/form-data）：
   * - 参考图作为 `image` 文件字段（PNG），从 data URL 解 base64 得到 Buffer；
   * - prompt/model/size 作为普通表单字段；
   * - 不手动设 Content-Type，由 fetch+FormData 自动生成 boundary。
   */
  async function postImageEdit(
    provider: MediaStudioProviderConfig,
    model: string,
    prompt: string,
    size: string | undefined,
    referenceDataUrl: string,
  ): Promise<Record<string, unknown>> {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    if (size) form.append("size", size);
    const base64 = referenceDataUrl.split(",", 2)[1] ?? "";
    const bytes = Buffer.from(base64, "base64");
    form.append("image", new Blob([bytes], { type: "image/png" }), "reference.png");
    const response = await fetchAuth(`${provider.baseUrl}/images/edits`, provider.apiKey, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  async function runVideoJob(
    jobId: string,
    provider: MediaStudioProviderConfig,
    model: string,
  ): Promise<void> {
    const found = await locateJob(jobId);
    if (!found) return;
    let remoteTaskId = found.record.remoteTaskId;
    if (!remoteTaskId) {
      const submitted = await fetchJson(`${provider.baseUrl}/videos/generations`, provider.apiKey, {
        method: "POST",
        body: JSON.stringify({ model, prompt: found.record.prompt }),
      });
      remoteTaskId = typeof submitted.id === "string" ? submitted.id : undefined;
      if (!remoteTaskId) throw new Error("provider response has no task id");
      await updateJob(jobId, { remoteTaskId, status: "running" });
    }
    const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
    for (;;) {
      if (Date.now() > deadline) throw new Error("video task polling timeout");
      await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
      const state = await fetchJson(
        `${provider.baseUrl}/videos/generations/${remoteTaskId}`,
        provider.apiKey,
      );
      const taskStatus = String(state.task_status ?? "").toUpperCase();
      if (taskStatus === "FAIL" || taskStatus === "FAILED" || taskStatus === "ERROR") {
        throw new Error(String(state.task_message ?? `remote task ${taskStatus}`));
      }
      if (taskStatus !== "SUCCESS" && taskStatus !== "SUCCEEDED") continue;
      const results = Array.isArray(state.video_result)
        ? (state.video_result as Record<string, unknown>[])
        : [];
      const videoUrl = typeof results[0]?.url === "string" ? results[0].url : null;
      if (!videoUrl) throw new Error("remote task succeeded without video url");
      const buffer = await downloadBuffer(videoUrl);
      const filePath = await saveJobFile("video", jobId, ".mp4", buffer);
      await updateJob(jobId, { status: "succeeded", filePath });
      return;
    }
  }

  async function runJob(
    jobId: string,
    model: string,
    referenceImage: { dataUrl: string } | undefined,
  ): Promise<void> {
    if (inflightJobIds.has(jobId)) return;
    inflightJobIds.add(jobId);
    try {
      const found = await locateJob(jobId);
      if (!found) return;
      const provider = await readProviderConfig(found.kind);
      if (!provider) {
        await updateJob(jobId, {
          status: "failed",
          error: `media studio ${found.kind} config missing`,
        });
        return;
      }
      if (found.kind === "image") await runImageJob(jobId, provider, model, referenceImage);
      else await runVideoJob(jobId, provider, model);
    } catch (error) {
      await updateJob(jobId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inflightJobIds.delete(jobId);
    }
  }

  // Host 重启后恢复：有 remoteTaskId 的 running 任务续轮询（不重复提交，使用落盘的 model）；
  // 尚未拿到 remoteTaskId 的 submitting 任务无法安全续跑（image i2i 的参考图也没持久化），直接终态化。
  void ready.then(async () => {
    for (const kind of JOB_KINDS) {
      for (const record of await loadJobs(kind)) {
        if (record.status === "running" && record.remoteTaskId && record.model) {
          void runJob(record.id, record.model, undefined);
        } else if (record.status === "submitting" || record.status === "running") {
          await updateJob(record.id, {
            status: "failed",
            error: "interrupted by host restart",
          });
        }
      }
    }
  });

  return {
    getConfig: async () => {
      await ready;
      const [image, video] = await Promise.all([
        readProviderConfig("image"),
        readProviderConfig("video"),
      ]);
      if (!image && !video) return null;
      return { image: toProviderView(image), video: toProviderView(video) };
    },

    saveConfig: async (config: MediaStudioConfig) => {
      await ready;
      for (const kind of JOB_KINDS) {
        const incoming = config[kind];
        const previous = await readProviderConfig(kind);
        // 某模态 apiKey 传空串时保留该模态已存的 key（掩码占位不代表用户重填）。
        const apiKey = incoming.apiKey.trim() || (previous?.apiKey ?? "");
        // models 优先按入参；空数组允许保存(用户清空)，与 provider 的 isProviderUsable 校验联动。
        const models = (Array.isArray(incoming.models) ? incoming.models : [])
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean);
        // model 与 models[0] 同步：旧字段保留是为了旧 layout migration 读得到值。
        const model = models[0] ?? incoming.model?.trim() ?? "";
        await writeProviderConfig(paths, kind, {
          baseUrl: incoming.baseUrl.trim(),
          apiKey,
          model,
          models,
          ...(incoming.i2iMode ? { i2iMode: incoming.i2iMode } : {}),
        });
      }
    },

    listJobs: async () => {
      await ready;
      const [imageJobs, videoJobs] = await Promise.all([loadJobs("image"), loadJobs("video")]);
      return [...imageJobs, ...videoJobs]
        .sort((left, right) => right.createdAt - left.createdAt)
        .map(toSummary);
    },

    createJob: async (input) => {
      await ready;
      const provider = await readProviderConfig(input.kind);
      if (!provider) {
        throw new Error(`media studio ${input.kind} provider not configured`);
      }
      if (!input.model.trim()) {
        throw new Error(`media studio ${input.kind} model not selected`);
      }
      const now = Date.now();
      const record: MediaStudioJobRecord = {
        id: createUuid(),
        kind: input.kind,
        prompt: input.prompt,
        size: input.size,
        model: input.model.trim(),
        status: "submitting",
        // 仅标记参考图存在性与来源；图本身已在本次请求中带出，不再持久化。
        hasReferenceImage: input.referenceImage !== undefined,
        referenceFromJobId: input.referenceFromJobId,
        createdAt: now,
        updatedAt: now,
      };
      (await loadJobs(input.kind)).push(record);
      await persistJobs(input.kind);
      void runJob(record.id, input.model.trim(), input.referenceImage);
      return toSummary(record);
    },

    deleteJob: async (jobId) => {
      await ready;
      const found = await locateJob(jobId);
      if (!found) return;
      const records = await loadJobs(found.kind);
      const index = records.findIndex((job) => job.id === jobId);
      if (index < 0) return;
      const [removed] = records.splice(index, 1);
      await persistJobs(found.kind);
      if (removed?.filePath) await rm(removed.filePath, { force: true });
    },

    readJobFileDataUrl: async (jobId) => {
      await ready;
      const found = await locateJob(jobId);
      const filePath = found?.record.filePath;
      if (!filePath) return null;
      try {
        const buffer = await readFile(filePath);
        const mime = DATA_URL_MIME_BY_EXTENSION[extname(filePath).toLowerCase()];
        if (!mime) return null;
        return `data:${mime};base64,${buffer.toString("base64")}`;
      } catch {
        return null;
      }
    },

    getStorageRoot: async () => {
      await ready;
      // 返回前幂等建目录：全新安装时目录可能尚不存在，
      // macOS open 对不存在路径会失败，必须保证设置页「看到路径即可打开」。
      await ensureKindDirs(paths);
      return paths.rootDir;
    },
  };
}
