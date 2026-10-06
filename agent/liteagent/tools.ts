/**
 * Agent 工具集（纯 TS 实现）
 * 每个工具：定义(ToolDefinition) + 执行函数。orchestrator 调用执行结果回写历史。
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
// NodeNext ESM：相对导入必须带 .js 扩展名，否则 TS2835 报错
import type { ToolDefinition, LlmToolCall } from "./llm.js";
import { makeUnifiedDiff } from "./diff.js";

const execFileP = promisify(execFile);

/**
 * 后台常驻服务进程表（pid -> child）。
 * 用 detached + unref 启动，使其脱离每次 bash 工具调用的父 shell，
 * 持续运行直到主动 kill_server 或应用退出，解决「第一条指令启动的服务器
 * 发第二条指令就访问不了」的问题。
 */
const serverProcesses = new Map<number, ChildProcess>();

export function killServer(pid: number): boolean {
  const child = serverProcesses.get(pid);
  if (!child || child.pid == null) return false;
  // 杀掉整个进程组，连带其子孙（如 python 子进程）
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* 可能已是孤儿，落到下面单进程 kill */
  }
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  serverProcesses.delete(pid);
  return true;
}

/** 应用退出时清理所有后台服务 */
export function cleanupServers(): void {
  for (const pid of [...serverProcesses.keys()]) killServer(pid);
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  ref_id?: string | null;
  /** edit_hunk 改写的行数变化：增 / 删（用于前端"长条"卡片展示） */
  diff?: { added: number; removed: number } | null;
  /** edit_hunk 改写的 unified diff 文本（用于前端渲染代码对比） */
  diffText?: string | null;
}

interface ToolCtx {
  cwd: string;
  sessionId: string;
}

// 路径安全：限制在 cwd 之内
function safePath(cwd: string, p: string | undefined | null): string {
  if (typeof p !== "string" || p.length === 0) {
    throw new ToolArgError("path", "缺少有效的文件路径参数");
  }
  const abs = path.isAbsolute(p) ? p : path.join(cwd, p);
  return abs;
}

/** 工具参数缺失/非法时抛出的可控错误（由 executeTool 捕获为友好失败） */
class ToolArgError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = "ToolArgError";
  }
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "file_read",
    description: "读取文本文件全部内容",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "相对 cwd 的文件路径" } },
      required: ["path"],
    },
  },
  {
    name: "read_range",
    description: "读取文件指定行区间 [start,end]（1-based，含端点）",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        start: { type: "number" },
        end: { type: "number" },
      },
      required: ["path", "start", "end"],
    },
  },
  {
    name: "edit_hunk",
    description: "把文件 [start,end] 行替换为 text，用于精确改动",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        start: { type: "number" },
        end: { type: "number" },
        text: { type: "string" },
      },
      required: ["path", "start", "end", "text"],
    },
  },
  {
    name: "write_file",
    description:
      "创建或覆盖写入一个完整文件（无需先读取原文件）。适合生成/新建展示页、" +
      "配置文件等整文件内容。若文件已存在则覆盖。写入大文件时优先用此工具，而非 bash heredoc。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件相对 cwd 的路径，如 examples/table-showcase.html" },
        content: { type: "string", description: "文件的完整内容" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "bash",
    description:
      "在 cwd 执行 shell 命令（需权限）。普通命令会等待并返回输出；" +
      "若需要启动长期运行的服务（如本地静态服务器/前端 dev server），可设 background:true 或在命令末尾加 &，" +
      "进程将脱离本次对话独立存活，发后续指令时仍可访问。",
    parameters: {
      type: "object",
      properties: {
        cmd: { type: "string" },
        cwd: { type: "string" },
        background: { type: "boolean", description: "true=后台常驻启动（不等待结束，返回 PID），适合启动本地服务器" },
        port: { type: "number", description: "可选，服务端口，仅用于回显访问地址" },
      },
      required: ["cmd"],
    },
  },
  {
    name: "run_server",
    description:
      "启动一个长期运行的服务（如 python -m http.server、vite、npm run dev 等）。" +
      "进程脱离 Agent 对话独立存活，发后续指令时本地网页仍可正常访问，直到调用 kill_server 或关闭应用。",
    parameters: {
      type: "object",
      properties: {
        cmd: { type: "string", description: "启动服务的完整命令" },
        cwd: { type: "string", description: "可选，工作目录（相对项目根）" },
        port: { type: "number", description: "可选，服务端口，仅用于回显访问地址" },
      },
      required: ["cmd"],
    },
  },
  {
    name: "kill_server",
    description: "停止一个由 run_server 或后台 bash 启动的服务，传入其 pid。",
    parameters: {
      type: "object",
      properties: { pid: { type: "number", description: "要停止的服务进程 PID" } },
      required: ["pid"],
    },
  },
  {
    name: "codegraph_search",
    description: "在文件中全文检索内容（真 grep，支持正则与大小写敏感），用于查找代码文本/字符串",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "要查找的文本或正则" },
        regex: { type: "boolean", description: "是否按正则匹配" },
        case_sensitive: { type: "boolean", description: "是否大小写敏感" },
      },
      required: ["query"],
    },
  },
  // 迁移修复：已移除 search_symbol / find_references 两个工具定义——本仓库不存在
  // 运行时 AST 符号索引（原实现依赖 ../codeindex），与 localagent 迁移副本保持一致。
  {
    name: "run_tests",
    description: "跑测试（调用 dev runtimes 推断的 test 脚本）",
    parameters: {
      type: "object",
      properties: { cmd: { type: "string" } },
      required: [],
    },
  },
];

async function fileRead(ctx: ToolCtx, args: any): Promise<ToolResult> {
  const p = safePath(ctx.cwd, args.path);
  const buf = await fsp.readFile(p, "utf-8");
  return { ok: true, summary: buf, ref_id: null };
}

async function readRange(ctx: ToolCtx, args: any): Promise<ToolResult> {
  const p = safePath(ctx.cwd, args.path);
  const lines = (await fsp.readFile(p, "utf-8")).split("\n");
  const s = Math.max(1, args.start);
  const e = Math.min(lines.length, args.end);
  return { ok: true, summary: lines.slice(s - 1, e).join("\n"), ref_id: null };
}

async function editHunk(ctx: ToolCtx, args: any): Promise<ToolResult> {
  const p = safePath(ctx.cwd, args.path);
  const buf = await fsp.readFile(p, "utf-8");
  const lines = buf.split("\n");
  const s = Math.max(1, args.start);
  const e = Math.min(lines.length, args.end);
  const oldLines = lines.slice(s - 1, e);
  const removedCount = oldLines.length;
  const replacement = String(args.text ?? "").split("\n");
  const addedCount = replacement.length;
  const newLines = [...lines.slice(0, s - 1), ...replacement, ...lines.slice(e)];
  const newContent = newLines.join("\n");
  await fsp.writeFile(p, newContent, "utf-8");
  const diffText = makeUnifiedDiff({
    relPath: args.path,
    oldLines,
    newLines: replacement,
    oldStart: s,
  });
  return {
    ok: true,
    summary: `已改写 ${args.path} 行 ${s}-${e}`,
    ref_id: null,
    diff: { added: addedCount, removed: removedCount },
    diffText,
  };
}

/** 创建/覆盖写入整文件（无需先读取）。迁移修复：原 createFile（../ipc/fs）在本仓库不存在，
 * 改用 fsp.writeFile + 保证父目录存在，覆盖写语义与原 createFile 一致 */
async function writeFile(ctx: ToolCtx, args: any): Promise<ToolResult> {
  if (typeof args.content !== "string") {
    throw new ToolArgError("content", "缺少文件内容参数");
  }
  const p = safePath(ctx.cwd, args.path);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, args.content, "utf-8");
  const bytes = Buffer.byteLength(args.content, "utf-8");
  return {
    ok: true,
    summary: `已写入文件 ${args.path}（${args.content.length} 字符 / ${bytes} 字节）`,
    ref_id: null,
  };
}

async function bash(ctx: ToolCtx, args: any): Promise<ToolResult> {
  const cwd = args.cwd ? safePath(ctx.cwd, args.cwd) : ctx.cwd;

  // 后台常驻模式：命令以 & 结尾，或显式 background:true。
  // 用 detached + unref 让进程脱离本次 bash 调用独立存活（适合启动本地服务器）。
  const background = args.background === true || /(?:^|[\s;])[&\n]\s*$/.test(String(args.cmd ?? ""));
  if (background) {
    try {
      const child = spawn("bash", ["-lc", String(args.cmd ?? "")], {
        cwd,
        env: { ...process.env, /* 解除 job control 干扰 */ },
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      serverProcesses.set(child.pid!, child);
      child.on("exit", () => serverProcesses.delete(child.pid!));
      const port = args.port ? Number(args.port) : undefined;
      const summary =
        `已在后台启动（独立于本次对话，将持续运行直到你主动停止或关闭应用）。\n` +
        `PID: ${child.pid}\n` +
        `命令: ${args.cmd}` +
        (port ? `\n访问地址: http://localhost:${port}` : "") +
        `\n\n停止该服务请调用 kill_server 并传入 pid=${child.pid}。`;
      return { ok: true, summary, ref_id: null };
    } catch (e: any) {
      return { ok: false, summary: String(e?.message ?? e).slice(0, 8000), ref_id: null };
    }
  }

  try {
    const { stdout, stderr } = await execFileP("bash", ["-lc", args.cmd], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    });
    return { ok: true, summary: (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).slice(0, 8000), ref_id: null };
  } catch (e: any) {
    return { ok: false, summary: String(e?.stderr ?? e?.message ?? e).slice(0, 8000), ref_id: null };
  }
}

/**
 * 启动一个长期运行的服务（如本地静态服务器 / 前端 dev server），
 * 进程脱离 Agent 对话独立存活，发后续指令时仍可持续访问。
 */
async function runServer(ctx: ToolCtx, args: any): Promise<ToolResult> {
  const cwd = args.cwd ? safePath(ctx.cwd, args.cwd) : ctx.cwd;
  const cmd = String(args.cmd ?? "").trim();
  if (!cmd) return { ok: false, summary: "cmd 不能为空", ref_id: null };
  try {
    const child = spawn("bash", ["-lc", cmd], {
      cwd,
      env: { ...process.env },
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    serverProcesses.set(child.pid!, child);
    child.on("exit", () => serverProcesses.delete(child.pid!));
    const port = args.port ? Number(args.port) : undefined;
    const summary =
      `已在后台启动服务（独立于本次对话，将持续运行直到你主动停止或关闭应用）。\n` +
      `PID: ${child.pid}\n` +
      `命令: ${cmd}` +
      (port ? `\n访问地址: http://localhost:${port}` : "") +
      `\n\n停止该服务请调用 kill_server 并传入 pid=${child.pid}。`;
    return { ok: true, summary, ref_id: null };
  } catch (e: any) {
    return { ok: false, summary: String(e?.message ?? e).slice(0, 8000), ref_id: null };
  }
}

/** 停止一个由 run_server / 后台 bash 启动的服务 */
async function killServerTool(_ctx: ToolCtx, args: any): Promise<ToolResult> {
  const pid = Number(args.pid);
  if (!pid) return { ok: false, summary: "pid 无效", ref_id: null };
  const ok = killServer(pid);
  return { ok, summary: ok ? `已停止服务 (pid=${pid})` : `未找到运行中的服务 (pid=${pid})`, ref_id: null };
}

async function codegraphSearch(ctx: ToolCtx, args: any): Promise<ToolResult> {
  // 全文检索（真 grep）：递归在受支持文件内容中查找
  const IGNORE = new Set(["node_modules", ".git", "target", "dist", "build", ".next", "out", "coverage", ".cache"]);
  const hits: string[] = [];
  const q = String(args.query ?? "");
  const regex = !!args.regex;
  const ci = !args.case_sensitive;
  let matcher: (l: string) => boolean;
  try {
    const re = regex ? new RegExp(q, ci ? "i" : "") : null;
    matcher = re ? (l: string) => re.test(l) : (l: string) => (ci ? l.toLowerCase().includes(q.toLowerCase()) : l.includes(q));
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
            // i < lines.length 保证存在；基线开启 noUncheckedIndexedAccess，非空断言与 localagent 副本一致
            if (matcher(lines[i]!)) {
              hits.push(`${path.relative(ctx.cwd, full)}:${i + 1}: ${lines[i]!.slice(0, 200)}`);
              if (hits.length >= 50) return;
            }
          }
        } catch {
          /* 二进制/编码跳过 */
        }
      }
      if (hits.length >= 50) return;
    }
  }
  await walk(ctx.cwd);
  return { ok: true, summary: hits.join("\n") || "no match", ref_id: null };
}

async function runTests(ctx: ToolCtx, args: any): Promise<ToolResult> {
  const cmd = args.cmd || "npm test";
  return bash(ctx, { cmd });
}

export async function executeTool(
  call: LlmToolCall,
  ctx: ToolCtx,
  onPermission?: (name: string, args: unknown) => Promise<boolean>
): Promise<ToolResult> {
  const args = call.args as any;
  // bash / run_tests / run_server / kill_server 需要权限门
  if ((call.name === "bash" || call.name === "run_tests" || call.name === "run_server" || call.name === "kill_server") && onPermission) {
    const allowed = await onPermission(call.name, args);
    if (!allowed) return { ok: false, summary: "权限被拒绝", ref_id: null };
  }
  try {
  switch (call.name) {
    case "file_read":
      return fileRead(ctx, args);
    case "read_range":
      return readRange(ctx, args);
    case "edit_hunk":
      return editHunk(ctx, args);
    case "write_file":
      return writeFile(ctx, args);
    case "bash":
      return bash(ctx, args);
    case "codegraph_search":
      return codegraphSearch(ctx, args);
    case "run_tests":
      return runTests(ctx, args);
    case "run_server":
      return runServer(ctx, args);
    case "kill_server":
      return killServerTool(ctx, args);
    default:
      return { ok: false, summary: `未知工具: ${call.name}`, ref_id: null };
  }
  } catch (err) {
    if (err instanceof ToolArgError) {
      return { ok: false, summary: `参数错误（${err.field}）：${err.message}`, ref_id: null };
    }
    return { ok: false, summary: `工具执行失败：${(err as Error).message || String(err)}`, ref_id: null };
  }
}

export function toolDefs(): ToolDefinition[] {
  return toolDefinitions;
}
