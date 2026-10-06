/**
 * Media Studio 任务卡 —— 紧凑等宽瀑布流（CSS columns + break-inside-avoid）。
 * 列宽固定小尺寸（由画廊容器控制），高度按产物宽高比推出：
 * 只体现比例不跟真实像素尺寸走，体量紧凑。
 * 提示词不占常驻文本区：hover 时以底部渐变遮罩显示提示词/模型/失败原因。
 */
import { ImageDown, Loader2, Trash2, Video as VideoIcon } from "lucide-react";
import type { MediaStudioJobSummary } from "@opennativeai/services";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";

export function MediaStudioJobCard({
  job,
  preview,
  onDelete,
  onPreview,
  onUseAsReference,
}: {
  job: MediaStudioJobSummary;
  preview: string | undefined;
  onDelete: (jobId: string) => void;
  onPreview?: (jobId: string) => void;
  /** 图生图专用：把当前卡片的产物作为下一次生成的参考图灌入创作面板。
   *  仅 image 模态可用，video 不暴露该入口。 */
  onUseAsReference?: (jobId: string) => void;
}) {
  const { intl } = useOpenNativeAIIntl();
  const active = job.status === "submitting" || job.status === "running";
  const succeeded = job.status === "succeeded" && Boolean(preview);
  const canUseAsReference = job.kind === "image" && succeeded;

  return (
    <li
      className="group relative mb-3 break-inside-avoid overflow-hidden rounded-lg border border-border bg-surface"
      title={job.prompt}
    >
      {succeeded ? (
        job.kind === "video" ? (
          // 列宽固定、高度由原生比例推出；产物以 data URL 内联预览，避免 Renderer 直接访问文件系统。
          <video src={preview} controls preload="metadata" className="block w-full" />
        ) : (
          // 点击图片触发画廊预览（黑色背景 lightbox）；video 保留原生控件，不进预览。
          <img
            src={preview}
            alt={job.prompt}
            className="block w-full cursor-pointer"
            onClick={() => onPreview?.(job.id)}
          />
        )
      ) : (
        // 非终态/无产物时用方形占位，瀑布流列高不至于塌陷。
        <div className="flex aspect-square w-full items-center justify-center">
          {active ? (
            <Loader2 className="size-6 animate-spin text-foreground-subtle" />
          ) : (
            <span className="px-3 text-center text-ui-xs text-foreground-subtlest">
              {intl.formatMessage({ id: "mediaStudio.jobs.noPreview" })}
            </span>
          )}
        </div>
      )}

      {/* 左上徽标：视频类型 + 非终态状态 + i2i 标记；成功产物不常驻状态，保持画面干净。 */}
      {job.kind === "video" || active || job.status === "failed" || job.hasReferenceImage ? (
        <div className="pointer-events-none absolute top-1.5 left-1.5 flex items-center gap-1">
          {job.kind === "video" ? (
            <span className="inline-flex items-center rounded-full bg-black/45 p-1 text-white">
              <VideoIcon className="size-3" />
            </span>
          ) : null}
          {job.hasReferenceImage && job.kind === "image" ? (
            <span className="inline-flex items-center rounded-full bg-black/45 px-2 py-0.5 font-mono text-ui-xs uppercase tracking-wide text-white">
              i2i
            </span>
          ) : null}
          {active || job.status === "failed" ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-ui-xs text-white",
                job.status === "failed" && "bg-destructive/85",
              )}
            >
              {active ? <Loader2 className="size-3 animate-spin" /> : null}
              {intl.formatMessage({ id: `mediaStudio.status.${job.status}` })}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* 图生图入口：仅 image 且 succeeded 时显示；与删除按钮同侧，靠左一格。 */}
      {canUseAsReference && onUseAsReference ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1.5 right-9 bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/60 hover:text-white focus-visible:opacity-100"
          aria-label={intl.formatMessage({ id: "mediaStudio.jobs.useAsReference" })}
          title={intl.formatMessage({ id: "mediaStudio.jobs.useAsReference" })}
          onClick={() => onUseAsReference(job.id)}
        >
          <ImageDown className="size-3.5" />
        </Button>
      ) : null}

      {/* 删除按钮：hover 才出现，不占常驻布局。 */}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute top-1.5 right-1.5 bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/60 hover:text-white focus-visible:opacity-100"
        aria-label={intl.formatMessage({ id: "mediaStudio.jobs.delete" })}
        onClick={() => onDelete(job.id)}
      >
        <Trash2 className="size-3.5" />
      </Button>

      {/* 底部悬浮遮罩：提示词 + 模型 +（失败时）错误原因。 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-2 pt-6 pb-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <p className="line-clamp-2 text-ui-xs text-white/90">{job.prompt}</p>
        {job.model ? (
          <p className="truncate font-mono text-ui-xs text-white/60">{job.model}</p>
        ) : null}
        {job.status === "failed" && job.error ? (
          <p className="line-clamp-2 break-words text-ui-xs text-white/60">{job.error}</p>
        ) : null}
      </div>
    </li>
  );
}
