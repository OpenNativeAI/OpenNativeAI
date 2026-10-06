/**
 * MediaStudioPane —— 图像/视频生成的独立界面。
 *
 * 该面板与会话/分享/回放链路完全隔离：只通过 IMediaStudioService 读写独立存储
 * （~/.opennativeai/media-studio），不触碰任务列表、session 或 runtime 状态。
 * Renderer 只做投影：任务状态、产物均由 Host service 唯一持有，这里定时拉取快照。
 */
/* eslint-disable max-lines -- 面板承载画廊 + 创作 + 图生图参考图槽 + 预览弹窗,
   单一文件保留便于跨状态推演;若继续增长再拆分子组件。 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Image as ImageIcon,
  ImageDown,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Video as VideoIcon,
  X as XIcon,
} from "lucide-react";
import type {
  IMediaStudioService,
  MediaStudioJobKind,
  MediaStudioJobSummary,
} from "@opennativeai/services";
import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Textarea } from "@/components/ui/textarea.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { setPendingSettingsSection } from "@/lib/settingsNavigation.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { MediaStudioJobCard } from "./MediaStudioJobCard.js";
import { MediaStudioPreviewDialog } from "./MediaStudioPreviewDialog.js";
import { MEDIA_STUDIO_SIZE_AUTO, MediaStudioSizeSelect } from "./MediaStudioSizeSelect.js";

/** 存在非终态任务时的快照轮询间隔；仅用于投影，不作为状态来源。 */
const JOBS_POLL_INTERVAL_MS = 2_000;

type SavedConfig = Awaited<ReturnType<IMediaStudioService["getConfig"]>>;

function hasActiveJob(jobs: readonly MediaStudioJobSummary[]): boolean {
  return jobs.some((job) => job.status === "submitting" || job.status === "running");
}

export function MediaStudioPane({ service }: { service: IMediaStudioService }) {
  const { intl } = useOpenNativeAIIntl();

  const [config, setConfig] = useState<SavedConfig>(null);
  // 配置读写入口在设置页「多模态」分区；这里只读门控，不提供写入。
  const [jobs, setJobs] = useState<MediaStudioJobSummary[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const [kind, setKind] = useState<MediaStudioJobKind>("image");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState(MEDIA_STUDIO_SIZE_AUTO);
  const [model, setModel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 创作面板可收起：浏览历史产物时腾出整行宽度，点按钮再展开。
  const [panelOpen, setPanelOpen] = useState(true);
  // 图片预览：仅记录被点开的 jobId；真正展示的 src/alt 由 jobs/previews 派生，避免单独存副本。
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  // 图生图参考图（仅 image 模态）：data URL + 可选来源 jobId；
  // 不持久化，提交时一次性带出，关闭面板或刷新即丢——与 spec §5.1「不落盘」一致。
  const [referenceImage, setReferenceImage] = useState<{
    dataUrl: string;
    sourceJobId?: string;
  } | null>(null);
  const [referenceDragOver, setReferenceDragOver] = useState(false);
  const referenceInputRef = useRef<HTMLInputElement>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const next = await service.listJobs();
      if (!mountedRef.current) return;
      setJobs(next);
    } catch (error) {
      logger.warn("[media-studio] 加载任务列表失败", { error });
    }
  }, [service]);

  // 初次加载：读取已保存配置与任务快照。
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const [savedConfig, savedJobs] = await Promise.all([
          service.getConfig(),
          service.listJobs(),
        ]);
        if (disposed) return;
        setConfig(savedConfig);
        setJobs(savedJobs);
      } catch (error) {
        logger.warn("[media-studio] 初始化失败", { error });
      }
    })();
    return () => {
      disposed = true;
    };
  }, [service]);

  // 配置按模态独立（图像/视频各自的供应商）：切换 kind 时把 model 选择同步到对应模态的默认模型。
  // 默认取 models[0]；若当前选中的 model 还在该模态的 models 列表里就保留,让用户能跨切换保留选择。
  const kindConfig = config?.[kind];
  useEffect(() => {
    if (!kindConfig) {
      setModel("");
      return;
    }
    const available = kindConfig.models;
    if (available.length === 0) {
      setModel("");
      return;
    }
    if (model && available.includes(model)) return;
    const first = available[0] ?? "";
    setModel(first);
  }, [kind, kindConfig, model]);

  // 仅当存在非终态任务时轮询快照；全部终态后停止，避免无谓 IPC。
  useEffect(() => {
    if (!hasActiveJob(jobs)) return;
    const timer = setInterval(() => {
      void refreshJobs();
    }, JOBS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [jobs, refreshJobs]);

  // 参考图仅对 image 模态有意义：切到 video 时同步清空，避免提交时残留旧参考图。
  useEffect(() => {
    if (kind !== "image" && referenceImage !== null) {
      setReferenceImage(null);
      setReferenceDragOver(false);
      if (referenceInputRef.current) referenceInputRef.current.value = "";
    }
  }, [kind, referenceImage]);

  // 产物预览：为已成功的任务按需拉取 data URL，命中缓存后不重复请求。
  useEffect(() => {
    let disposed = false;
    const targets = jobs.filter(
      (job) => job.status === "succeeded" && previews[job.id] === undefined,
    );
    if (targets.length === 0) return;
    void (async () => {
      const entries: Array<[string, string]> = [];
      for (const job of targets) {
        try {
          const dataUrl = await service.readJobFileDataUrl(job.id);
          // null 表示产物缺失（可能被外部删除）；用空串占位避免反复重试。
          entries.push([job.id, dataUrl ?? ""]);
        } catch (error) {
          logger.warn("[media-studio] 读取产物失败", { jobId: job.id, error });
          entries.push([job.id, ""]);
        }
      }
      if (disposed || entries.length === 0) return;
      setPreviews((prev) => {
        const next = { ...prev };
        for (const [id, dataUrl] of entries) next[id] = dataUrl;
        return next;
      });
    })();
    return () => {
      disposed = true;
    };
    // previews  intentionally not a dependency: 只在 jobs 变化时补齐缺失项。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, service]);

  const openSettingsTab = useTabStore((state) => state.openSettingsTab);
  const handleOpenSettings = useCallback(() => {
    setPendingSettingsSection("multimodal");
    openSettingsTab();
  }, [openSettingsTab]);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim()) return;
    if (!model.trim()) {
      toast(intl.formatMessage({ id: "mediaStudio.create.modelRequired" }), {
        variant: "warning",
      });
      return;
    }
    setSubmitting(true);
    try {
      // model 已在表单下拉里显式选择 — 直接传 createJob,不再回写 config。
      // 图生图参考图：仅 image 模态且当前持有 referenceImage 时携带；video 永远不带。
      await service.createJob({
        kind,
        model: model.trim(),
        prompt: prompt.trim(),
        ...(size !== MEDIA_STUDIO_SIZE_AUTO ? { size } : {}),
        ...(kind === "image" && referenceImage
          ? {
              referenceImage: { dataUrl: referenceImage.dataUrl },
              ...(referenceImage.sourceJobId
                ? { referenceFromJobId: referenceImage.sourceJobId }
                : {}),
            }
          : {}),
      });
      if (!mountedRef.current) return;
      setPrompt("");
      setSize(MEDIA_STUDIO_SIZE_AUTO);
      // 提交成功后清空参考图，避免下一次提交误带上上一轮的图。
      if (kind === "image") {
        setReferenceImage(null);
        if (referenceInputRef.current) referenceInputRef.current.value = "";
      }
      await refreshJobs();
    } catch (error) {
      logger.error("[media-studio] 提交生成任务失败", { error });
      toast(
        error instanceof Error
          ? error.message
          : intl.formatMessage({ id: "mediaStudio.create.failed" }),
        { variant: "warning" },
      );
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }, [intl, kind, model, prompt, referenceImage, refreshJobs, service, size]);

  /** 将用户拖拽或选择的本地文件读取为 data URL，写入 referenceImage。 */
  const handleReferenceFile = useCallback((file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast(intl.formatMessage({ id: "mediaStudio.reference.invalidFile" }), {
        variant: "warning",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (!dataUrl) return;
      // 本地上传不记录 sourceJobId；只有从画廊复用才会写入。
      setReferenceImage({ dataUrl });
    };
    reader.onerror = () => {
      logger.warn("[media-studio] 读取参考图失败", { error: reader.error });
    };
    reader.readAsDataURL(file);
  }, []);

  /** 画廊卡片点「作为参考图」：直接把已缓存的预览 data URL 灌入槽位。 */
  const handleUseAsReference = useCallback(
    (jobId: string) => {
      const preview = previews[jobId];
      if (!preview) return;
      // 若当前在 video 模态：自动切到 image，让参考图立刻可用。
      if (kind !== "image") setKind("image");
      setReferenceImage({ dataUrl: preview, sourceJobId: jobId });
    },
    [kind, previews],
  );

  const handleDelete = useCallback(
    async (jobId: string) => {
      try {
        await service.deleteJob(jobId);
        if (!mountedRef.current) return;
        setPreviews((prev) => {
          const next = { ...prev };
          delete next[jobId];
          return next;
        });
        await refreshJobs();
      } catch (error) {
        logger.error("[media-studio] 删除任务失败", { jobId, error });
        toast(intl.formatMessage({ id: "mediaStudio.jobs.deleteFailed" }), { variant: "warning" });
      }
    },
    [intl, refreshJobs, service],
  );

  // 配置按模态独立（图像/视频各自的供应商）：门控只看当前选中模态。
  const configReady = Boolean(
    kindConfig?.baseUrl && kindConfig?.hasApiKey && kindConfig.models.length > 0,
  );
  const canSubmit =
    configReady && prompt.trim().length > 0 && model.trim().length > 0 && !submitting;
  // 预览对象直接由 previewJobId 派生，避免与 jobs 出现状态副本不一致。
  const previewJob = previewJobId ? (jobs.find((job) => job.id === previewJobId) ?? null) : null;

  return (
    // 壳层把主视图全高交给本组件：桌面下中间画廊自带滚动区，
    // 创作面板 dock 成全高右侧栏（border-l + 独立滚动，可收起）；
    // 移动端回到单列整页滚动、创作置顶便于直接输入。
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable] lg:flex-row lg:overflow-hidden">
      {/* 中间：任务画廊 */}
      <section className="order-2 flex min-h-0 min-w-0 flex-1 flex-col lg:order-1">
        {/* 中间内容区域：滚动条默认隐藏，鼠标 hover 或键盘 focus 进入时再出现（autohide overlay 样式）。 */}
        <div className="scrollbar-autohide min-h-0 flex-1 [scrollbar-gutter:stable] lg:overflow-y-auto">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-4 md:px-6 md:py-6">
            <header className="flex items-center gap-2">
              <Clapperboard className="size-4 text-foreground-subtle" />
              <h2 className="text-ui-base font-medium text-foreground">
                {intl.formatMessage({ id: "mediaStudio.jobs.title" })}
              </h2>
              {jobs.length > 0 ? (
                <span className="rounded-full bg-surface px-2 py-0.5 text-ui-xs text-foreground-subtle">
                  {jobs.length}
                </span>
              ) : null}
            </header>
            {jobs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "mediaStudio.jobs.empty" })}
              </p>
            ) : (
              // 定死 4 列等宽瀑布流（窄屏 2 列）：高度按各自比例推出，列表已按创建时间倒序，
              // 新任务永远叠在各列最上方；列数不随窗口变宽而增到 5 列。
              <ul className="columns-2 gap-3 md:columns-4">
                {jobs.map((job) => (
                  <MediaStudioJobCard
                    key={job.id}
                    job={job}
                    preview={previews[job.id]}
                    onDelete={handleDelete}
                    onPreview={setPreviewJobId}
                    onUseAsReference={handleUseAsReference}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* 右侧：创作面板 dock 成全高右侧栏；收起时不留轨道，只在原位悬浮一个展开按钮 */}
      {panelOpen ? (
        <aside className="order-1 flex w-full shrink-0 flex-col bg-card lg:order-2 lg:h-full lg:w-[320px] lg:border-l lg:border-border">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
            <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={kind === "image"}
                onClick={() => setKind("image")}
                className={cn(
                  kind === "image"
                    ? "bg-selected text-foreground"
                    : "text-foreground-subtle hover:bg-transparent hover:text-foreground",
                )}
              >
                <ImageIcon className="size-3.5" />
                {intl.formatMessage({ id: "mediaStudio.create.kind.image" })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={kind === "video"}
                onClick={() => setKind("video")}
                className={cn(
                  kind === "video"
                    ? "bg-selected text-foreground"
                    : "text-foreground-subtle hover:bg-transparent hover:text-foreground",
                )}
              >
                <VideoIcon className="size-3.5" />
                {intl.formatMessage({ id: "mediaStudio.create.kind.video" })}
              </Button>
            </div>
            {/* 生成按钮紧跟切换控件右侧，与表单内容解耦、随时可提交。 */}
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="shrink-0"
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {intl.formatMessage({ id: "mediaStudio.create.submit" })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ml-auto shrink-0 text-foreground-subtle hover:text-foreground"
              aria-label={intl.formatMessage({ id: "mediaStudio.create.collapse" })}
              title={intl.formatMessage({ id: "mediaStudio.create.collapse" })}
              onClick={() => setPanelOpen(false)}
            >
              <PanelRightClose className="size-3.5" />
            </Button>
          </header>
          <div className="min-h-0 flex-1 px-3 pb-3 [scrollbar-gutter:stable] lg:overflow-y-auto">
            {!configReady ? (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-surface px-2.5 py-1.5">
                <p className="text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: "mediaStudio.create.needConfig" })}
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={handleOpenSettings}>
                  {intl.formatMessage({ id: "mediaStudio.create.openSettings" })}
                </Button>
              </div>
            ) : null}
            {/* 图生图参考图槽位：仅 image 模态下展示；video 时被 useEffect 清空。 */}
            {kind === "image" ? (
              <div className="mb-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({ id: "mediaStudio.reference.label" })}
                  </span>
                  {referenceImage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={intl.formatMessage({ id: "mediaStudio.reference.remove" })}
                      title={intl.formatMessage({ id: "mediaStudio.reference.remove" })}
                      onClick={() => {
                        setReferenceImage(null);
                        setReferenceDragOver(false);
                        if (referenceInputRef.current) referenceInputRef.current.value = "";
                      }}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
                {referenceImage ? (
                  // 已有参考图时显示缩略图 + 来源徽标；不暴露删除以外的入口，
                  // 避免在槽位内再加一层按钮影响密度。
                  <div className="relative overflow-hidden rounded-md border border-border bg-surface">
                    <img
                      src={referenceImage.dataUrl}
                      alt=""
                      className="max-h-32 w-full object-contain"
                    />
                    <span className="pointer-events-none absolute left-1 top-1 rounded-full bg-card/80 px-1.5 py-0.5 text-ui-xs text-foreground-subtle">
                      {referenceImage.sourceJobId
                        ? intl.formatMessage({ id: "mediaStudio.reference.fromGallery" })
                        : intl.formatMessage({ id: "mediaStudio.reference.fromLocal" })}
                    </span>
                  </div>
                ) : (
                  // 空槽位 = dropzone + 隐藏 file input；label 包整体可点击触发系统选图弹窗，
                  // drag/drop 直接写入 data URL。
                  <label
                    className={cn(
                      "flex w-full cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed px-3 py-4 text-ui-xs transition-colors",
                      referenceDragOver
                        ? "border-foreground bg-surface text-foreground"
                        : "border-border text-foreground-subtle hover:border-foreground-subtle",
                    )}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (!referenceDragOver) setReferenceDragOver(true);
                    }}
                    onDragLeave={(event) => {
                      // 仅在真正离开 dropzone 时清除高亮；子节点冒泡会触发，需用 relatedTarget 判定。
                      const related = event.relatedTarget as Node | null;
                      if (related && event.currentTarget.contains(related)) return;
                      setReferenceDragOver(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setReferenceDragOver(false);
                      handleReferenceFile(event.dataTransfer.files?.[0]);
                    }}
                  >
                    <ImageDown className="size-4" />
                    <span>{intl.formatMessage({ id: "mediaStudio.reference.dropzone" })}</span>
                    <input
                      ref={referenceInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        handleReferenceFile(event.target.files?.[0]);
                        // 清空 value 让同一文件能再次被选中触发 onChange。
                        event.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            ) : null}
            {/* 提示词：多行文本输入;Cmd/Ctrl+Enter 提交,与其他多模态面板习惯一致。 */}
            <label className="mb-2 flex w-full flex-col gap-1">
              <span className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "mediaStudio.create.prompt" })}
              </span>
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder={intl.formatMessage({
                  id: "mediaStudio.create.promptPlaceholder",
                })}
                disabled={!configReady}
                rows={4}
                className="min-h-[80px] resize-y font-mono text-ui-sm"
              />
            </label>
            <label className="mb-2 flex w-full flex-col gap-1">
              <span className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "mediaStudio.create.model" })}
              </span>
              <Select
                value={model}
                onValueChange={setModel}
                disabled={(kindConfig?.models.length ?? 0) === 0}
              >
                <SelectTrigger className="h-8 w-full font-mono">
                  <SelectValue
                    placeholder={intl.formatMessage({
                      id: "mediaStudio.create.modelPlaceholder",
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(kindConfig?.models ?? []).map((option) => (
                    <SelectItem key={option} value={option} className="font-mono">
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(kindConfig?.models.length ?? 0) === 0 ? (
                <span className="text-ui-xs text-foreground-subtle">
                  {intl.formatMessage({ id: "mediaStudio.create.modelEmptyHint" })}
                </span>
              ) : null}
            </label>
            {/* 尺寸下拉带按比例缩放的矩形图形，拆到 MediaStudioSizeSelect 独立维护。 */}
            {kind === "image" ? <MediaStudioSizeSelect value={size} onChange={setSize} /> : null}
            {/* 生成入口已上移到头部切换右侧，这里只保留计费提示。 */}
            <p className="text-ui-xs text-foreground-subtlest">
              {intl.formatMessage({ id: "mediaStudio.create.billingHint" })}
            </p>
          </div>
        </aside>
      ) : (
        // 与展开时收起按钮同一坐标悬浮：右缘内缩 12px；20px 按钮在 48px 头部内垂直居中 → top 14px。
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute right-3 top-[14px] z-10 border border-border bg-card text-foreground-subtle shadow-sm hover:text-foreground"
          aria-label={intl.formatMessage({ id: "mediaStudio.create.expand" })}
          title={intl.formatMessage({ id: "mediaStudio.create.expand" })}
          onClick={() => setPanelOpen(true)}
        >
          <PanelRightOpen className="size-3.5" />
        </Button>
      )}

      <MediaStudioPreviewDialog
        open={previewJobId !== null}
        // 直接清空 jobId：组件在内部命中 `if (!open) return null` 后整体卸载，state 与 DOM 同步释放。
        onClose={() => setPreviewJobId(null)}
        src={previewJob ? previews[previewJob.id] : undefined}
        alt={previewJob?.prompt ?? ""}
      />
    </div>
  );
}
