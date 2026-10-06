import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMediaStudioService } from "../src/media-studio/mediaStudioService.js";
import { setDataBaseDir } from "../src/paths.js";
import type { MediaStudioJobSummary } from "../src/media-studio/mediaStudio.js";

/** 构造最小 Response 双端体：ok/json/text/arrayBuffer，满足 service 的读取路径。 */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-type" ? "application/json" : null;
      },
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new Uint8Array(Buffer.from(JSON.stringify(body))).buffer,
  } as unknown as Response;
}

function bufferResponse(bytes: Buffer, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-type" ? "application/octet-stream" : null;
      },
    },
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
    text: async () => "",
    json: async () => ({}),
  } as unknown as Response;
}

/** 轮询 listJobs 直到命中判定或超时；用于等待 service 内部异步推进。 */
async function waitForJob(
  service: ReturnType<typeof createMediaStudioService>,
  jobId: string,
  predicate: (job: MediaStudioJobSummary) => boolean,
  timeoutMs = 20_000,
): Promise<MediaStudioJobSummary> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const jobs = await service.listJobs();
    const job = jobs.find((item) => item.id === jobId);
    if (job && predicate(job)) return job;
    if (Date.now() > deadline) {
      throw new Error(`waitForJob timeout, last=${JSON.stringify(job)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const BASE_URL = "https://provider.test/api";
// 配置按模态独立：图像/视频各自的 baseUrl/apiKey/models，可指向不同供应商；model 为 models[0] 的兼容字段。
const CONFIG = {
  image: {
    baseUrl: BASE_URL,
    apiKey: "sk-test-1234567890",
    model: "image-model",
    models: ["image-model"],
  },
  video: {
    baseUrl: BASE_URL,
    apiKey: "sk-test-1234567890",
    model: "video-model",
    models: ["video-model"],
  },
};

test("config: legacy flat config migrates to per-modality providers, empty apiKey keeps old key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opennativeai-media-legacy-"));
  setDataBaseDir(dir);
  const mediaRoot = join(dir, ".opennativeai", "media-studio");
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(mediaRoot, { recursive: true });
  // 旧扁平结构：单一 baseUrl/apiKey + imageModel/videoModel。
  await writeFile(
    join(mediaRoot, "config.json"),
    JSON.stringify({
      baseUrl: BASE_URL,
      apiKey: "sk-legacy-123456",
      imageModel: "img-1",
      videoModel: "vid-1",
    }),
  );

  try {
    const service = createMediaStudioService();
    const config = await service.getConfig();
    assert.ok(config);
    assert.equal(config.image.baseUrl, BASE_URL);
    assert.equal(config.image.model, "img-1");
    assert.equal(config.video.model, "vid-1");
    assert.equal(config.image.hasApiKey, true);
    // 迁移后旧扁平文件删除，配置落在各模态独立目录。
    const migratedImage = JSON.parse(
      await readFile(join(mediaRoot, "image", "config.json"), "utf8"),
    );
    assert.equal(migratedImage.model, "img-1");
    await assert.rejects(readFile(join(mediaRoot, "config.json"), "utf8"));

    // 保存时 apiKey 传空串 → 沿用已存的旧 key（掩码占位不代表用户重填）。
    await service.saveConfig({
      image: { baseUrl: BASE_URL, apiKey: "", model: "img-2", models: ["img-2"] },
      video: { baseUrl: BASE_URL, apiKey: "", model: "vid-2", models: ["vid-2"] },
    });
    const after = await service.getConfig();
    assert.equal(after?.image.model, "img-2");
    assert.deepEqual(after?.image.models, ["img-2"]);
    assert.equal(after?.image.hasApiKey, true);
  } finally {
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("image job: submit, land file, expose data URL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opennativeai-media-image-"));
  setDataBaseDir(dir);
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (url.endsWith("/images/generations")) {
      return jsonResponse({ data: [{ b64_json: pngBytes.toString("base64") }] });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const service = createMediaStudioService();
    // 存储根目录暴露给设置页「多模态」分区展示与打开。
    assert.equal(await service.getStorageRoot(), join(dir, ".opennativeai", "media-studio"));
    await service.saveConfig(CONFIG);
    const created = await service.createJob({
      kind: "image",
      model: "image-model",
      prompt: "a cat",
      size: "1024x1024",
    });
    assert.equal(created.status, "submitting");

    const succeeded = await waitForJob(service, created.id, (job) => job.status === "succeeded");
    assert.equal(succeeded.status, "succeeded");

    // 产物落盘到图像模态独立目录（image/files/），且可回读为 data URL 供 Renderer 预览。
    const filePath = join(dir, ".opennativeai", "media-studio", "image", "files", `${created.id}.png`);
    const onDisk = await readFile(filePath);
    assert.deepEqual(onDisk, pngBytes);

    const dataUrl = await service.readJobFileDataUrl(created.id);
    assert.equal(dataUrl, `data:image/png;base64,${pngBytes.toString("base64")}`);
  } finally {
    globalThis.fetch = originalFetch;
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("image job: reference image (i2i) posts multipart to /images/edits with image file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opennativeai-media-i2i-"));
  setDataBaseDir(dir);
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x4a, 0x1a, 0x0a]);
  // 模拟 data URL 内的 base64 段（参考图实际字节，由前端 readAsDataURL 写入）。
  const refBase64 = pngBytes.toString("base64");
  const refDataUrl = `data:image/png;base64,${refBase64}`;
  let capturedContentType: string | null = null;
  let capturedBodyBytes: Buffer | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    // 走 Request 重新构造一次：fetch 在收到 FormData body 时会在内部自动补 Content-Type + boundary，
    // 但 init.headers 仍是调用方声明的；用 Request 才能拿到最终出站的头。
    const request = new Request(url, init);
    capturedContentType = request.headers.get("Content-Type");
    capturedBodyBytes = Buffer.from(await request.arrayBuffer());
    if (request.url.endsWith("/images/edits") && request.method === "POST") {
      return jsonResponse({ data: [{ b64_json: pngBytes.toString("base64") }] });
    }
    throw new Error(`unexpected fetch ${request.url}`);
  }) as typeof fetch;

  try {
    const service = createMediaStudioService();
    await service.saveConfig(CONFIG);
    const created = await service.createJob({
      kind: "image",
      model: "image-model",
      prompt: "turn it into watercolor",
      size: "1024x1024",
      referenceImage: { dataUrl: refDataUrl },
      referenceFromJobId: "source-job-123",
    });
    assert.equal(created.status, "submitting");
    // 任务摘要应回传 hasReferenceImage=true 与来源 ID，但不包含图本身。
    assert.equal(created.hasReferenceImage, true);
    assert.equal(created.referenceFromJobId, "source-job-123");
    assert.equal((created as unknown as { referenceImage?: unknown }).referenceImage, undefined);

    const succeeded = await waitForJob(service, created.id, (job) => job.status === "succeeded");
    assert.equal(succeeded.hasReferenceImage, true);
    assert.equal(succeeded.referenceFromJobId, "source-job-123");

    // 走 edits 端点 + POST + multipart（Content-Type 由 fetch 自动生成 boundary）。
    // capturedContentType / capturedBodyBytes 是闭包外赋值的可变变量,TS 没法穿过闭包还原类型,
    // 在断言前显式断言为非 null 以避免 TS 把它收窄成 never。
    const contentType = capturedContentType as string | null;
    const bodyBytes = capturedBodyBytes as Buffer | null;
    assert.ok(
      contentType?.startsWith("multipart/form-data; boundary="),
      `expected multipart content-type with boundary, got ${contentType}`,
    );
    assert.ok(bodyBytes, "multipart body not captured");
    const bodyText = bodyBytes.toString("binary");
    // multipart 体内应同时含 image 文件段 + prompt/model/size 表单段。
    assert.ok(
      bodyText.includes('name="image"') && bodyText.includes('filename="reference.png"'),
      "image file part missing in multipart body",
    );
    assert.ok(bodyText.includes('name="prompt"'), "prompt field missing");
    assert.ok(bodyText.includes("turn it into watercolor"), "prompt value missing");
    assert.ok(bodyText.includes('name="model"'), "model field missing");
    assert.ok(bodyText.includes("image-model"), "model value missing");
    assert.ok(bodyText.includes('name="size"'), "size field missing");
    assert.ok(bodyText.includes("1024x1024"), "size value missing");
    // multipart 文件段是 raw bytes，不是 base64；以 PNG magic (0x89 "PNG") 验证参考图原字节透传。
    assert.ok(bodyText.includes("PNG"), "PNG signature missing in body");
    assert.ok(
      bodyBytes.includes(pngBytes),
      "reference image bytes not present verbatim in multipart body",
    );

    // 确认 media-studio 目录下没有任何 .ref.* 文件（参考图不落盘）。
    const refDir = join(dir, ".opennativeai", "media-studio", "image", "files");
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(refDir);
    assert.ok(
      entries.every((name) => !name.endsWith(".ref.png") && !name.includes(".ref.")),
      `unexpected reference file under files/: ${entries.join(",")}`,
    );
    // 仅生成产物 png 存在；来源 ID 不应被误写为文件。
    assert.deepEqual(entries, [`${created.id}.png`]);
  } finally {
    globalThis.fetch = originalFetch;
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("image job: i2i with image-url-json mode posts image_url field on /images/generations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opennativeai-media-i2i-urljson-"));
  setDataBaseDir(dir);
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x4a, 0x1a, 0x0a]);
  const refDataUrl = `data:image/png;base64,${pngBytes.toString("base64")}`;
  let capturedUrl: string | null = null;
  let capturedBody: Record<string, unknown> | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    if (url.endsWith("/images/generations") && init?.method === "POST") {
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({ data: [{ b64_json: pngBytes.toString("base64") }] });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const service = createMediaStudioService();
    await service.saveConfig({
      ...CONFIG,
      image: { ...CONFIG.image, i2iMode: "image-url-json" },
    });
    const created = await service.createJob({
      kind: "image",
      model: "image-model",
      prompt: "turn it into watercolor",
      size: "1024x1024",
      referenceImage: { dataUrl: refDataUrl },
      referenceFromJobId: "source-job",
    });
    const succeeded = await waitForJob(service, created.id, (job) => job.status === "succeeded");
    assert.equal(succeeded.status, "succeeded");
    assert.equal(capturedUrl, `${BASE_URL}/images/generations`);
    assert.ok(capturedBody, "request body was not captured");
    const body = capturedBody as Record<string, unknown>;
    assert.equal(body.image_url, refDataUrl);
    assert.equal(body.prompt, "turn it into watercolor");
    assert.equal(body.size, "1024x1024");
  } finally {
    globalThis.fetch = originalFetch;
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("image job: i2i with input-images-json mode posts input_images array on /images/generations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opennativeai-media-i2i-input-"));
  setDataBaseDir(dir);
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x4a, 0x1a, 0x0a]);
  const refDataUrl = `data:image/png;base64,${pngBytes.toString("base64")}`;
  let capturedBody: Record<string, unknown> | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/images/generations") && init?.method === "POST") {
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({ data: [{ b64_json: pngBytes.toString("base64") }] });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const service = createMediaStudioService();
    await service.saveConfig({
      ...CONFIG,
      image: { ...CONFIG.image, i2iMode: "input-images-json" },
    });
    const created = await service.createJob({
      kind: "image",
      model: "image-model",
      prompt: "make it purple",
      referenceImage: { dataUrl: refDataUrl },
    });
    const succeeded = await waitForJob(service, created.id, (job) => job.status === "succeeded");
    assert.equal(succeeded.status, "succeeded");
    assert.ok(capturedBody, "request body was not captured");
    const body = capturedBody as Record<string, unknown>;
    assert.deepEqual(body.input_images, [refDataUrl]);
    assert.equal(body.prompt, "make it purple");
  } finally {
    globalThis.fetch = originalFetch;
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("config: i2iMode round-trips through saveConfig/getConfig", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opennativeai-media-i2i-roundtrip-"));
  setDataBaseDir(dir);
  try {
    const service = createMediaStudioService();
    await service.saveConfig({
      ...CONFIG,
      image: { ...CONFIG.image, i2iMode: "input-images-json" },
    });
    const view = await service.getConfig();
    assert.ok(view, "expected getConfig to return non-null");
    assert.equal(view?.image.i2iMode, "input-images-json");
  } finally {
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("video job: submit, poll remote task, land mp4", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opennativeai-media-video-"));
  setDataBaseDir(dir);
  const mp4Bytes = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/videos/generations") && init?.method === "POST") {
      return jsonResponse({ id: "remote-task-1" });
    }
    if (url.endsWith("/videos/generations/remote-task-1")) {
      return jsonResponse({
        task_status: "SUCCESS",
        video_result: [{ url: "https://cdn.test/video.mp4" }],
      });
    }
    if (url === "https://cdn.test/video.mp4") {
      return bufferResponse(mp4Bytes);
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const service = createMediaStudioService();
    await service.saveConfig(CONFIG);
    const created = await service.createJob({
      kind: "video",
      model: "video-model",
      prompt: "a running dog",
    });
    const succeeded = await waitForJob(service, created.id, (job) => job.status === "succeeded");
    assert.equal(succeeded.status, "succeeded");

    const filePath = join(dir, ".opennativeai", "media-studio", "video", "files", `${created.id}.mp4`);
    const onDisk = await readFile(filePath);
    assert.deepEqual(onDisk, mp4Bytes);
  } finally {
    globalThis.fetch = originalFetch;
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("host restart: submitting job without remoteTaskId is failed, not silently retried", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opennativeai-media-restore-"));
  setDataBaseDir(dir);
  const mediaRoot = join(dir, ".opennativeai", "media-studio");
  // 预置一份 Host 崩溃前遗留的 jobs.json：submitting 且无 remoteTaskId。
  const staleJob = {
    id: "stale-1",
    kind: "image",
    prompt: "interrupted",
    status: "submitting",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(mediaRoot, { recursive: true });
  await writeFile(join(mediaRoot, "jobs.json"), JSON.stringify([staleJob], null, 2));

  try {
    // 重新创建 service 模拟 Host 重启；恢复逻辑应把无法安全续跑的任务终态化为 failed。
    const service = createMediaStudioService();
    const job = await waitForJob(service, "stale-1", (item) => item.status === "failed", 5_000);
    assert.equal(job.status, "failed");
    assert.equal(job.error, "interrupted by host restart");
  } finally {
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});
