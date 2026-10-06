const SUPPORTED_DESKTOP_PLATFORM_KEYS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
];

// node-llama-cpp v3 将各系统/后端的 llama.cpp 预编译物发布为 @node-llama-cpp/<variant>
// optional dependency，pnpm 在跨平台安装时会把全部 13 套装进 node_modules（本地安装需要
// 探测可用后端，安装包不需要）。未裁剪时 darwin-arm64 的 app.asar 内有约 697 MiB 属于
// 其他平台（仅 linux-x64-cuda-ext 的 libggml-cuda.so 就占 357 MiB），直接顶穿
// audit-bundle-size.mjs 的 500 MiB 产物上限。
const NODE_LLAMA_CPP_VARIANTS = [
  "linux-arm64",
  "linux-armv7l",
  "linux-x64",
  "linux-x64-cuda",
  "linux-x64-cuda-ext",
  "linux-x64-vulkan",
  "mac-arm64-metal",
  "mac-x64",
  "win-arm64",
  "win-x64",
  "win-x64-cuda",
  "win-x64-cuda-ext",
  "win-x64-vulkan",
];

// 同一 Linux/Windows 目标保留该系统全部 GPU 后端，运行时由 node-llama-cpp 自行选择；
// macOS 只有 Metal 一条路径，因此按架构再收紧一档。linux-armv7l 不是支持的桌面目标。
const NODE_LLAMA_CPP_VARIANTS_BY_TARGET = {
  "darwin-arm64": ["mac-arm64-metal"],
  "darwin-x64": ["mac-x64"],
  "linux-arm64": ["linux-arm64"],
  "linux-x64": ["linux-x64", "linux-x64-cuda", "linux-x64-cuda-ext", "linux-x64-vulkan"],
  "win32-arm64": ["win-arm64"],
  "win32-x64": ["win-x64", "win-x64-cuda", "win-x64-cuda-ext", "win-x64-vulkan"],
};

function getNodeLlamaCppVariantSet(targetPlatformKey) {
  return new Set(NODE_LLAMA_CPP_VARIANTS_BY_TARGET[targetPlatformKey]);
}

function assertSupportedTargetPlatformKey(targetPlatformKey) {
  if (!SUPPORTED_DESKTOP_PLATFORM_KEYS.includes(targetPlatformKey)) {
    throw new Error(`不支持的桌面目标平台: ${targetPlatformKey}`);
  }
}

export function createDesktopNativePackagePrunePatterns(targetPlatformKey) {
  assertSupportedTargetPlatformKey(targetPlatformKey);

  return [
    // PDF 预览已经由 Vite 打进 renderer，pdfjs-dist 的 Canvas optional dependency
    // 只服务 Node 渲染；pnpm 跨平台安装的 8 套 Canvas native 不应带进桌面安装包。
    "!node_modules/@napi-rs/canvas/**",
    "!node_modules/@napi-rs/canvas-*/**",
    // Linux prebuild 会在 beforePack 复制进 node-pty；源平台包本身不属于桌面运行时。
    "!node_modules/@lydell/node-pty-*/**",
    // 桌面运行时统一使用目标 prebuild，禁止把安装机现场编译物或 ABI bin 缓存带进跨平台包。
    "!node_modules/node-pty/build/**",
    "!node_modules/node-pty/bin/**",
    // llama.cpp 预编译物只保留目标系统（macOS 还按架构）的后端包。
    ...NODE_LLAMA_CPP_VARIANTS.filter(
      (variant) => !getNodeLlamaCppVariantSet(targetPlatformKey).has(variant),
    ).map((variant) => `!node_modules/@node-llama-cpp/${variant}/**`),
    ...SUPPORTED_DESKTOP_PLATFORM_KEYS.filter((key) => key !== targetPlatformKey).map(
      (key) => `!node_modules/node-pty/prebuilds/${key}/**`,
    ),
  ];
}

function normalizeAsarPath(path) {
  const normalized = path.trim().replaceAll("\\", "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function parseAsarListWithPackState(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(pack|unpack)\s*:\s*(.+)$/.exec(line);
      if (!match) {
        throw new Error(`无法解析 asar pack state: ${line}`);
      }
      return { packState: match[1], path: normalizeAsarPath(match[2]) };
    });
}

function isNativeRuntimeFile(path, targetPlatformKey) {
  if (/\.(?:node|dll|dylib|exe)$/i.test(path)) return true;
  return path === `/node_modules/node-pty/prebuilds/${targetPlatformKey}/spawn-helper`;
}

export function findDesktopNativePackageViolations(entries, targetPlatformKey) {
  assertSupportedTargetPlatformKey(targetPlatformKey);
  const violations = [];

  for (const entry of entries) {
    const { packState, path } = entry;

    if (
      path === "/node_modules/@napi-rs/canvas" ||
      path.startsWith("/node_modules/@napi-rs/canvas/") ||
      path.startsWith("/node_modules/@napi-rs/canvas-")
    ) {
      violations.push(`不应打包 renderer 无需的 Canvas native: ${path}`);
      continue;
    }

    if (path.startsWith("/node_modules/@lydell/node-pty-")) {
      violations.push(`不应打包仅用于准备 prebuild 的平台源包: ${path}`);
      continue;
    }

    if (
      path.startsWith("/node_modules/node-pty/build/") ||
      path.startsWith("/node_modules/node-pty/bin/")
    ) {
      violations.push(`不应打包安装机生成的 node-pty 产物: ${path}`);
      continue;
    }

    const nodeLlamaMatch = /^\/node_modules\/@node-llama-cpp\/([^/]+)/.exec(path);
    if (nodeLlamaMatch && !getNodeLlamaCppVariantSet(targetPlatformKey).has(nodeLlamaMatch[1])) {
      violations.push(`node-llama-cpp 包含非目标平台预编译包: ${path}`);
      continue;
    }

    const nodePtyPrebuildMatch = /^\/node_modules\/node-pty\/prebuilds\/([^/]+)/.exec(path);
    if (nodePtyPrebuildMatch && nodePtyPrebuildMatch[1] !== targetPlatformKey) {
      violations.push(`node-pty 包含非目标平台 prebuild: ${path}`);
      continue;
    }

    if (isNativeRuntimeFile(path, targetPlatformKey) && packState !== "unpack") {
      violations.push(`native 文件仍作为 packed payload 留在 app.asar: ${path}`);
    }
  }

  return violations;
}
