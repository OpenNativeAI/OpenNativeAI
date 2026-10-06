/**
 * 媒体画廊图片预览：全屏黑色背景，无关闭按钮，点击空白区域关闭。
 * 设计目标：极简、点击关闭、关闭后彻底卸载组件以避免假关闭导致的 DOM/监听残留。
 * - 不引入 Radix Dialog：避免其 onInteractOutside / focus trap 等隐式行为与本组件的"点击背景关闭"语义冲突。
 * - 关闭时整组件返回 null，state、事件监听、图片 src 全部随之释放；下一次打开重新挂载即干净状态。
 */
import { useEffect } from "react";

export function MediaStudioPreviewDialog({
  open,
  onClose,
  src,
  alt,
}: {
  open: boolean;
  onClose: () => void;
  src: string | undefined;
  alt: string;
}) {
  // 仅在打开时挂 ESC 监听；open 转为 false 时立即卸载，cleanup 同步移除监听器。
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // 关闭即整体卸载：避免假关闭（overlay 节点仍在 DOM、事件仍在监听、state 残留）。
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      // 整层都是"黑色背景"：点击空白即触发关闭；图片自身的 click 会 stopPropagation。
      className="fixed inset-0 z-50 flex items-center justify-center bg-black"
      onClick={onClose}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          draggable={false}
          onClick={(event) => event.stopPropagation()}
          className="max-h-full max-w-full select-none object-contain"
        />
      ) : null}
    </div>
  );
}
