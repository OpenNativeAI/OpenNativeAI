/**
 * 统一 diff 生成（纯 TS，不依赖第三方库）。
 * 用于 Agent 改写类工具（edit_hunk 等）回传改动前后的代码对比。
 */

export interface UnifiedDiffOptions {
  /** 相对仓库根的路径，用于 diff 头（a/xxx、b/xxx） */
  relPath: string;
  /** 改写前（旧）的行 */
  oldLines: string[];
  /** 改写后（新）的行 */
  newLines: string[];
  /** 旧块的起始行号（1-based，对应被替换区间的 start） */
  oldStart: number;
  /** 新块的起始行号（1-based，通常与 oldStart 相同） */
  newStart?: number;
}

/**
 * 生成标准 unified diff 文本，并以 hunk 头标注行号。
 * 输出示例:
 *   --- a/foo.ts
 *   +++ b/foo.ts
 *   @@ -3,5 +3,4 @@
 *   -const a = 1
 *   +const a = 2
 *    const b = 3
 */
export function makeUnifiedDiff(opts: UnifiedDiffOptions): string {
  const newStart = opts.newStart ?? opts.oldStart;
  const out: string[] = [];
  out.push(`--- a/${opts.relPath}`);
  out.push(`+++ b/${opts.relPath}`);
  out.push(`@@ -${opts.oldStart},${opts.oldLines.length} +${newStart},${opts.newLines.length} @@`);

  const max = Math.max(opts.oldLines.length, opts.newLines.length);
  for (let i = 0; i < max; i++) {
    const o = opts.oldLines[i];
    const n = opts.newLines[i];
    if (o !== undefined && n !== undefined) {
      if (o === n) {
        out.push(` ${o}`);
      } else {
        out.push(`-${o}`);
        out.push(`+${n}`);
      }
    } else if (o !== undefined) {
      out.push(`-${o}`);
    } else if (n !== undefined) {
      out.push(`+${n}`);
    }
  }
  return out.join("\n");
}
