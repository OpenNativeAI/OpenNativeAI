/**
 * codegraph_search 工具：仓库内文件内容全文检索（真 grep）。
 *
 * 从 `tools.ts` 拆出，避免主文件超过 max-lines 400 约束；对上层 executeTool
 * 只暴露 `codegraphSearch(ctx, args)` 一个函数。
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { ToolResult } from "./tools.js";

interface SearchCtx {
  cwd: string;
}

const IGNORE = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  ".cache",
]);

const MAX_HITS = 50;

export async function codegraphSearch(
  ctx: SearchCtx,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const hits: string[] = [];
  const q = String(args.query ?? "");
  const regex = !!args.regex;
  const ci = !args.case_sensitive;
  let matcher: (l: string) => boolean;
  try {
    const re = regex ? new RegExp(q, ci ? "i" : "") : null;
    matcher = re
      ? (l: string) => re.test(l)
      : (l: string) => (ci ? l.toLowerCase().includes(q.toLowerCase()) : l.includes(q));
  } catch {
    return { ok: false, summary: `正则无效: ${q}`, ref_id: null };
  }
  async function walk(dir: string) {
    let list: fs.Dirent[];
    try {
      list = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of list) {
      if (IGNORE.has(d.name)) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        await walk(full);
      } else if (d.isFile()) {
        try {
          const content = await fsp.readFile(full, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (matcher(lines[i]!)) {
              hits.push(`${path.relative(ctx.cwd, full)}:${i + 1}: ${lines[i]!.slice(0, 200)}`);
              if (hits.length >= MAX_HITS) return;
            }
          }
        } catch {
          /* 二进制/编码跳过 */
        }
      }
      if (hits.length >= MAX_HITS) return;
    }
  }
  await walk(ctx.cwd);
  return { ok: true, summary: hits.join("\n") || "no match", ref_id: null };
}
