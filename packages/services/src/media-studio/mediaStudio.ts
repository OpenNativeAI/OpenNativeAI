import { ServiceChannels } from "@opennativeai/shared";
import { createServiceDescriptor } from "../descriptors.js";

/** 单模态供应商配置；图像与视频各自独立，可指向不同供应商。 */
export interface MediaStudioProviderConfig {
  baseUrl: string;
  apiKey: string;
  /** 兼容旧布局保留的「当前默认 model」字段 — 新数据以 models 为准。
   *  读盘时若 models 缺失,会把 model 合并进 models 数组；保存时与 models[0] 同步。 */
  model?: string;
  /** 该模态已配置的模型 ID 列表；生成页的下拉直接消费此字段。 */
  models: string[];
  /** 图生图参考图上传协议；不同中转站 / 模型对协议差异较大，提供切换兜底。
   *  - edits-multipart：OpenAI / Azure gpt-image 系标准，`POST /images/edits` + multipart image 文件字段
   *  - image-url-json：legacy，`POST /images/generations` + JSON `image_url` 字段（部分中转站用）
   *  - input-images-json：Qwen 风格，`POST /images/generations` + JSON `input_images` 字段
   *  不填则默认 edits-multipart（与当前中转文档一致）。 */
  i2iMode?: "edits-multipart" | "image-url-json" | "input-images-json";
}

/** Media Studio 供应商配置；apiKey 明文存于独立目录的 600 文件，不进入会话凭据体系。 */
export interface MediaStudioConfig {
  image: MediaStudioProviderConfig;
  video: MediaStudioProviderConfig;
}

/** getConfig 回显视图：不回传 apiKey 明文，仅掩码。 */
export interface MediaStudioProviderView {
  baseUrl: string;
  model: string;
  models: string[];
  apiKeyMasked: string;
  hasApiKey: boolean;
  i2iMode?: "edits-multipart" | "image-url-json" | "input-images-json";
}

export type MediaStudioJobKind = "image" | "video";

/** submitting=已受理待提交/同步生成中；running=远端异步任务轮询中；其余为终态。 */
export type MediaStudioJobStatus = "submitting" | "running" | "succeeded" | "failed";

export interface MediaStudioJobSummary {
  id: string;
  kind: MediaStudioJobKind;
  prompt: string;
  /** 用户在生成页下拉里选的模型 ID；用于任务卡片回显。 */
  model?: string;
  size?: string;
  status: MediaStudioJobStatus;
  error?: string;
  /** 是否使用了参考图（图生图）；用于卡片徽标与回放识别。仅 image 模态可能为 true。 */
  hasReferenceImage?: boolean;
  /** 参考图来源：画廊产物复用的源任务 ID；本地上传时为空。供 UI 渲染来源关联。 */
  referenceFromJobId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface IMediaStudioService {
  /** 读取供应商配置（图像/视频各自独立）；完全未配置时返回 null。apiKey 不回传明文，仅返回掩码。 */
  getConfig(): Promise<{
    image: MediaStudioProviderView;
    video: MediaStudioProviderView;
  } | null>;

  /** 保存供应商配置（config.json，权限 600）。 */
  saveConfig(config: MediaStudioConfig): Promise<void>;

  /** 任务索引快照；Renderer 以此投影，不持有状态副本。 */
  listJobs(): Promise<MediaStudioJobSummary[]>;

  /** 提交生成任务（计费操作）；立即返回 submitting 摘要，实际执行在服务内异步推进。
   * 调用方须显式传入本次使用的 model — 服务不再从持久化配置中默认取，
   *  以支持「下拉里选哪个就用哪个」的场景，避免 settings 与 create 的耦合。 */
  createJob(input: {
    kind: MediaStudioJobKind;
    model: string;
    prompt: string;
    size?: string;
    /** 图生图参考图（仅 image 模态生效）：data URL，由 Renderer 读本地文件或复用画廊产物得到。
     *  不落盘、不持久化，仅本次请求携带到上游 API。 */
    referenceImage?: { dataUrl: string };
    /** 画廊复用时的源任务 ID；本地上传时为空。仅用于追溯展示，不参与 API 请求。 */
    referenceFromJobId?: string;
  }): Promise<MediaStudioJobSummary>;

  /** 删除任务索引行与落盘文件。 */
  deleteJob(jobId: string): Promise<void>;

  /** 读取任务产物为 data URL 供 Renderer 预览；无产物返回 null。 */
  readJobFileDataUrl(jobId: string): Promise<string | null>;

  /** 多模态存储根目录绝对路径；设置页展示与文件管理器打开用。 */
  getStorageRoot(): Promise<string>;
}

export const IMediaStudioService = createServiceDescriptor<IMediaStudioService>(
  ServiceChannels.MediaStudio,
);
