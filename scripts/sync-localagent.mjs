#!/usr/bin/env node
/**
 * `pnpm localagent:sync` / `pnpm localagent:check`
 *
 * 检查仓库根 `agent/localagent/`（用户源）与运行副本
 * `apps/opennativeai-cli/packages/localagent/src/` 之间是否漂移。
 *
 * **默认只报告，不改写。** Phase 1 迁移过程中，CLI 包在机械变换（`.js` 后缀、
 * type-only 导入、`as any` 收敛）之外还做了非机械改进：
 *   - `llm.ts` 增加了 `AnthropicStreamChunk` / `OpenAIStreamChunk` 类型化流分片
 *   - `errors.ts` 的 tagError 用具体 `LlmErrorInfo` 类型而非 unknown cast
 *   - `orchestrator.ts` 移除了未使用的 `AgentEventBase` interface，长 union 换行
 *   - `tools.ts` 剥离 codeindex / ipc/fs 依赖并外移 `codegraph_search`
 * 这些改动无法从 root 单向机械生成，直接覆盖会倒退。因此本脚本仅提供：
 *   1. `--check`（默认）：跑一遍机械变换，比较产物与当前 CLI 包，报漂移；exit 1。
 *   2. `--apply`：确认后写入，仅同步 SYNCABLE 白名单里的文件；对 Phase 1
 *      的非机械改动敏感的用户应先在 `--check` 输出里 diff 再决定。
 *   3. `--file <name>`：只处理指定文件（配合 `--check`/`--apply`）。
 *
 * 不做的事：
 * - 不动 `bin.ts` / `index.ts`（CLI 包独有）
 * - 不动 `tools.ts` / `tools-codegraph.ts`（依赖结构改造，非机械）
 * - 不改 root 侧任何文件
 *
 * 详见 `docs/specs/localagent-protocol-adapter.md` §7。
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./spawn-command.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(repoRoot, "agent", "localagent");
const dstDir = join(repoRoot, "apps", "opennativeai-cli", "packages", "localagent", "src");

/**
 * 可以机械同步的文件清单；不在此列的走 drift 提示。
 */
const SYNCABLE = [
  "diff.ts",
  "errors.ts",
  "llm.ts",
  "orchestrator.ts",
  "validate-tool-call.ts",
];

/**
 * root 与 CLI 包中结构不同的文件：CLI 包做了非 mechanical 改造，脚本不覆盖。
 */
const MANUAL_ONLY = ["tools.ts", "tools-codegraph.ts"];

/**
 * 相对导入加 `.js` 后缀：NodeNext ESM 要求。匹配 "./xxx" / "../xxx"，
 * 跳过已带扩展或以 "/" 结尾的目录形式。
 */
function addJsExtension(code) {
  return code.replace(/(from\s+["'])(\.\.?\/[^"'\n]+?)(["'])/g, (match, prefix, spec, suffix) => {
    if (/\.(?:js|ts|json|css|node)$/.test(spec)) return match;
    if (spec.endsWith("/")) return match;
    return `${prefix}${spec}.js${suffix}`;
  });
}

const TYPE_ONLY_SYMBOLS = [
  "ChatMsg",
  "ModelConfig",
  "ChatOutcome",
  "ToolResult",
  "LlmErrorCode",
  "LlmErrorInfo",
  "ToolDefinition",
  "LlmToolCall",
  "UnifiedDiffOptions",
];

function annotateTypeOnlyImports(code) {
  return code.replace(
    /^import\s+\{([^}]+)\}\s+from\s+("[^"]+"|'[^']+')(;?)$/gm,
    (line, names, from, semi) => {
      const list = names
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
      const rewritten = list.map((n) => {
        const bare = n.replace(/^type\s+/, "");
        if (TYPE_ONLY_SYMBOLS.includes(bare)) return `type ${n}`;
        return n;
      });
      return `import { ${rewritten.join(", ")} } from ${from}${semi}`;
    },
  );
}

function narrowAnyCasts(code) {
  return code
    .replace(
      /\(\s*([\w$]+)\s+as\s+any\s*\)\s*\?\.\s*(cmd|pid|message)\b/g,
      (_m, target, field) => `(${target} as { ${field}?: unknown })?.${field}`,
    )
    .replace(/\(\s*err\s+as\s+any\s*\)/g, "(err as { message?: unknown })")
    .replace(/catch\s*\(\s*(\w+)\s*:\s*any\s*\)/g, "catch ($1)");
}

function transform(source) {
  let out = source;
  out = addJsExtension(out);
  out = annotateTypeOnlyImports(out);
  out = narrowAnyCasts(out);
  return out;
}

async function readIfExists(path) {
  if (!existsSync(path)) return null;
  return readFile(path, "utf8");
}

function parseArgs(argv) {
  const out = { apply: false, check: false, onlyFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--check") out.check = true;
    else if (a === "--file") {
      out.onlyFile = argv[i + 1] ?? null;
      i++;
    }
  }
  // 默认 check；显式 --apply 才写入。同时给两个 flag 时报错，避免误操作。
  if (out.apply && out.check) {
    console.error("[sync:localagent] --apply 与 --check 互斥");
    process.exit(2);
  }
  return out;
}

function reportDrift(file, expected, current) {
  if (expected === current) {
    console.log(`[sync:localagent] ${file}: in sync`);
    return 0;
  }
  const label = current === null ? "MISSING in CLI package" : "DRIFT";
  console.log(`[sync:localagent] ${file}: ${label}`);
  // 简易 diff 展示前 20 行差异，不做完整 diff
  const expectedLines = expected.split("\n");
  const currentLines = (current ?? "").split("\n");
  const max = Math.max(expectedLines.length, currentLines.length);
  let shown = 0;
  for (let i = 0; i < max && shown < 20; i++) {
    if (expectedLines[i] !== currentLines[i]) {
      console.log(`  L${i + 1}  expected: ${expectedLines[i] ?? "<eof>"}`);
      console.log(`  L${i + 1}  current : ${currentLines[i] ?? "<eof>"}`);
      shown++;
    }
  }
  if (shown === 20) console.log(`  ... 剩余差异使用 diff -u ${join(dstDir, file)} 查看`);
  return 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = args.onlyFile ? [args.onlyFile] : SYNCABLE;
  for (const file of targets) {
    if (!SYNCABLE.includes(file)) {
      console.error(
        `[sync:localagent] --file ${file} 不在 SYNCABLE 白名单：${SYNCABLE.join(", ")}`,
      );
      process.exitCode = 2;
      return;
    }
  }

  let drift = 0;
  const written = [];
  for (const file of targets) {
    const srcPath = join(srcDir, file);
    const dstPath = join(dstDir, file);
    const source = await readIfExists(srcPath);
    if (source === null) {
      console.error(`[sync:localagent] source missing: ${srcPath}`);
      process.exitCode = 2;
      return;
    }
    const expected = transform(source);
    const current = await readIfExists(dstPath);
    const before = drift;
    drift += reportDrift(file, expected, current);
    if (drift > before && args.apply) {
      await writeFile(dstPath, expected, "utf8");
      written.push(file);
    }
  }

  // 手动维护文件：仅报告是否存在，不比较内容
  for (const file of MANUAL_ONLY) {
    if (!existsSync(join(dstDir, file))) {
      console.warn(
        `[sync:localagent] manual-maintained file missing: ${relative(repoRoot, join(dstDir, file))}`,
      );
      drift += 1;
    }
  }

  if (written.length > 0) {
    // 格式化只在真有写入时跑。注意两个约束：
    // 1. 仓库根 .prettierignore 把 apps/opennativeai-cli/ 整日屏蔽，根 oxfmt
    //    不能越目录改写子项目；用 apps/opennativeai-cli 自带的 oxfmt (0.47)。
    // 2. pnpm exec 在部分 sandbox 下无法写临时目录，直接调 node_modules 入口。
    console.log(`[sync:localagent] 应用 apps/opennativeai-cli 自带的 oxfmt`);
    const cliRoot = join(repoRoot, "apps", "opennativeai-cli");
    runCommand(
      process.execPath,
      [
        join(cliRoot, "node_modules", "oxfmt", "bin", "oxfmt"),
        ...written.map((f) => join("packages", "localagent", "src", f)),
      ],
      { cwd: cliRoot, stdio: "inherit" },
    );
  }

  if (drift > 0 && !args.apply) {
    console.error(
      `\n[sync:localagent] 发现 ${drift} 处漂移。默认不写入，避免倒退 Phase 1 的非机械改动。`,
    );
    console.error(
      `[sync:localagent] 若确认 root 侧修改需要下发到 CLI 包，追加 --apply；或手动 diff 合并。`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`[sync:localagent] 完成（漂移 ${drift} 项${args.apply ? "，已写入" : ""}）`);
}

await main();
