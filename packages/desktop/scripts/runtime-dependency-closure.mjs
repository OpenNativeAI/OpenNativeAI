import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, parse, resolve } from "node:path";
import { builtinModules, createRequire } from "node:module";
import asar from "@electron/asar";
import semver from "semver";

function isPackageNameDeclared(packageJsonPath) {
  try {
    return typeof JSON.parse(readFileSync(packageJsonPath, "utf8")).name === "string";
  } catch {
    return false;
  }
}

/**
 * 从 require.resolve 拿到的入口文件向上找真正的包根目录。
 *
 * 不能停在第一个碰到的 package.json：很多包在 dist/cjs、umd、esm 之类的子目录里放了
 * 只写 {"type":"commonjs"} 的模块类型标记文件。long@5 的入口是 umd/index.js、
 * signal-exit@4 的入口是 dist/cjs/index.js，把它们当成包根会让注入进 app.asar 的
 * package.json 只剩 25 字节的标记文件，运行时既读不到 version 也读不到真实入口，
 * 表现为依赖校验反复报缺失。这里取「越过 node_modules 边界前最后一个带 name 的目录」。
 */
function findPackageRoot(entryPath) {
  const rootDir = parse(dirname(entryPath)).root;
  let currentDir = dirname(entryPath);
  let packageRoot = null;
  while (currentDir !== rootDir) {
    if (basename(currentDir) === "node_modules") {
      break;
    }
    const packageJsonPath = resolve(currentDir, "package.json");
    if (existsSync(packageJsonPath) && isPackageNameDeclared(packageJsonPath)) {
      packageRoot = currentDir;
    }
    currentDir = dirname(currentDir);
  }
  return packageRoot;
}

/**
 * 计算包目录相对于 node_modules 根的路径（如 `which/node_modules/isexe`、`@scope/pkg`）。
 *
 * 必须保留嵌套层级：pnpm 在 hoisted 布局下只把「无冲突」的版本提到顶层，版本冲突的正确版本
 * 留在 <父包>/node_modules/<dep>。运行时的解析结果取决于这个层级，注入时也只能按同一层级落盘；
 * 只按包名决定位置会让另一个同名不同版的父包读到错误版本（which@6 与 which@2 抢同一个
 * node_modules/which/node_modules/isexe 就是这么误判的）。
 */
function toPackageRelDir(packageRoot) {
  const segments = packageRoot.split(/[\\/]/).filter(Boolean);
  const firstIndex = segments.indexOf("node_modules");
  if (firstIndex === -1) {
    return null;
  }
  const relativeSegments = segments.slice(firstIndex + 1);
  if (relativeSegments.length === 0) {
    return null;
  }
  // node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg> 是 pnpm 的真实存储目录，只用来取文件内容，
  // 打进 app.asar 时按顶层包名放，否则会把 pnpm 的存储结构一起复制进运行时。
  if (relativeSegments[0] === ".pnpm") {
    const lastIndex = segments.lastIndexOf("node_modules");
    return segments.slice(lastIndex + 1).join("/") || null;
  }
  return relativeSegments.join("/");
}

function readRuntimePackage(moduleLookupRoots, moduleName, parentPackagePath = null) {
  if (parentPackagePath) {
    try {
      const requireFromParent = createRequire(parentPackagePath);
      const entryPath = requireFromParent.resolve(moduleName);
      const packageRoot = findPackageRoot(entryPath);
      if (packageRoot) {
        const packageJsonPath = resolve(packageRoot, "package.json");
        return {
          packageJson: JSON.parse(readFileSync(packageJsonPath, "utf8")),
          packageJsonPath,
          packageRoot,
          packageRelDir: toPackageRelDir(packageRoot),
        };
      }
    } catch {
      // 父包相对解析失败时，继续走 workspace lookup roots 兜底。
    }
  }

  for (const lookupRoot of moduleLookupRoots) {
    const packageJsonPath = resolve(lookupRoot, "node_modules", moduleName, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    return {
      packageJson: JSON.parse(readFileSync(packageJsonPath, "utf8")),
      packageJsonPath,
      packageRoot: dirname(packageJsonPath),
      packageRelDir: moduleName,
    };
  }
  return null;
}

export function collectRuntimeModuleClosure(moduleNames, moduleLookupRoots) {
  return collectRuntimeModuleClosureEntries(moduleNames, moduleLookupRoots).map(
    (entry) => entry.moduleName,
  );
}

export function collectRuntimeModuleClosureEntries(
  moduleNames,
  moduleLookupRoots,
  { includeOptionalDependencies = true } = {},
) {
  const collected = [];
  const visited = new Set();

  function visit(moduleName, options = {}) {
    const {
      optional = false,
      parentPackagePath = null,
      parentModuleName = null,
      range = null,
    } = options;

    const runtimePackage = readRuntimePackage(moduleLookupRoots, moduleName, parentPackagePath);
    if (!runtimePackage && optional) {
      return;
    }

    const sourceModulePath = runtimePackage?.packageRoot ?? null;
    // 去重 key 是「包名 + 实际解析到的目录」，不能用包名：
    // 按包名去重时同名依赖只留下第一个父包声明的版本范围，第二个父包要的大版本根本不会被登记。
    // node-llama-cpp 要 lifecycle-utils@^4.5.2、另一个消费者把 2.1.0 hoist 到顶层就是这么漏判的，
    // 表现为安装包启动时 ESM 具名导入 SyntaxError: does not provide an export named ...。
    const visitKey = `${moduleName}@${sourceModulePath ?? "(unresolved)"}`;
    if (visited.has(visitKey)) {
      return;
    }
    visited.add(visitKey);

    collected.push({
      moduleName,
      sourceModulePath,
      // 注入位置和读取校验位置都以磁盘上的相对层级为准，保证包内解析结果和开发时一致。
      sourceRelDir: runtimePackage?.packageRelDir ?? null,
      packageJsonPath: runtimePackage?.packageJsonPath ?? null,
      // 保留一跳归属关系与父包声明的版本范围：产物里「有这个名字」不等于「版本能用」，
      // 判断该补到顶层还是补到父包名下都需要这两项。
      parentModuleName,
      requiredRange: range,
    });

    if (!runtimePackage) {
      return;
    }

    const { packageJson, packageJsonPath } = runtimePackage;
    const dependencies = packageJson.dependencies ?? {};
    const optionalDependencies = includeOptionalDependencies
      ? (packageJson.optionalDependencies ?? {})
      : {};
    const dependencyEntries = [
      ...Object.entries(dependencies).map(([dependencyName, dependencyRange]) => [
        dependencyName,
        dependencyRange,
        false,
      ]),
      ...Object.entries(optionalDependencies).map(([dependencyName, dependencyRange]) => [
        dependencyName,
        dependencyRange,
        true,
      ]),
    ];

    for (const [dependencyName, dependencyRange, isOptional] of dependencyEntries.sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      // 运行时外置包进了 app.asar 时，它的 hoisted 子依赖不会自动跟着进包。
      // 递归收集 dependencies，让打包注入和产物校验覆盖完整运行时解析链。
      // pnpm 多版本同名依赖下，不能每层都从固定 lookup roots 取第一个目录。
      // 例如 yazl 需要 buffer-crc32@1.x，而 desktop 测试依赖里还有 0.2.x；
      // 必须从父包 package.json 相对解析，才能复制到真实运行时会加载的版本。
      visit(dependencyName, {
        optional: isOptional,
        parentPackagePath: packageJsonPath,
        parentModuleName: moduleName,
        range: dependencyRange,
      });
    }
  }

  for (const moduleName of moduleNames) {
    visit(moduleName);
  }

  return collected;
}

const NODE_BUILTIN_MODULE_NAMES = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => moduleName.replace(/^node:/, "")),
]);

// electron 由运行时宿主提供，original-fs 是 Electron 内的 Node 内置变体，都不需要打进 app.asar。
const RUNTIME_PROVIDED_MODULE_NAMES = new Set(["electron", "original-fs"]);

const RUNTIME_ENTRY_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);

// 主进程、host、preload、scheduler 四份产物是真正在 Node 侧 require 的入口；
// out/renderer 由 Vite 预先打包，里面的 import 早已内联，扫它只会把渲染层依赖误判成运行时缺口。
const DESKTOP_RUNTIME_ENTRY_DIRS = ["main", "host", "preload", "scheduler"];

// npm 包名的合法字符集；用来剔掉对压缩产物做正则时捞到的碎片（如 `);`），避免它们进入闭包后
// 只能以“解析不到”的告警形式污染日志。
const VALID_PACKAGE_NAME_PATTERN = /^@?[a-z0-9._-][a-z0-9._@/-]*$/i;

function toBarePackageName(specifier) {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

function isPackagedRuntimeModuleName(moduleName) {
  if (!moduleName || !VALID_PACKAGE_NAME_PATTERN.test(moduleName)) {
    return false;
  }
  // @opennativeai/* 由 tsup 内联进产物，electron-builder 的 files 也显式排除了这些 workspace 包。
  if (moduleName.startsWith("@opennativeai/")) {
    return false;
  }
  if (RUNTIME_PROVIDED_MODULE_NAMES.has(moduleName)) {
    return false;
  }
  return !NODE_BUILTIN_MODULE_NAMES.has(moduleName);
}

function collectCodeFiles(directory, collected = []) {
  for (const dirent of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, dirent.name);
    if (dirent.isDirectory()) {
      collectCodeFiles(entryPath, collected);
    } else if (dirent.isFile() && RUNTIME_ENTRY_EXTENSIONS.has(extname(dirent.name))) {
      collected.push(entryPath);
    }
  }
  return collected;
}

const MODULE_SPECIFIER_PATTERN =
  /(?:\brequire\s*\(\s*|\bimport\s*\(\s*|\bfrom\s*|\bimport\s+)["']([^"']+)["']/g;

/**
 * 扫描桌面运行时产物里出现的裸包名，作为依赖闭包的自动根。
 *
 * 修复依据：仓库的 .npmrc 是 node-linker=hoisted，electron-builder 只按它自己算出的依赖树
 * 复制 node_modules。版本冲突时 pnpm 会把正确版本嵌套到 <父包>/node_modules/<dep> 下，
 * 而这批嵌套副本不会被收进 app.asar，于是安装包能正常生成、用户启动后 host 子进程才崩。
 * 先后出现过 node-llama-cpp 缺 chalk、pretty-ms 缺 parse-ms、js-yaml 缺 argparse 等十余例，
 * 全靠 REQUIRED_ASAR_RUNTIME_MODULES 手写名单逐个补，每崩一次才发现下一个。
 * 这里改成从 out/{main,host,preload,scheduler} 实际 import 的包出发自动推导闭包根，
 * 让 afterPack 注入和 bundle 校验都按产物真实解析链工作，不再依赖人工记忆。
 */
export function discoverDesktopRuntimeModuleNames(desktopRoot) {
  const names = new Set();
  for (const entryDirName of DESKTOP_RUNTIME_ENTRY_DIRS) {
    const entryDir = resolve(desktopRoot, "out", entryDirName);
    if (!existsSync(entryDir)) {
      continue;
    }
    for (const filePath of collectCodeFiles(entryDir)) {
      const source = readFileSync(filePath, "utf8");
      for (const match of source.matchAll(MODULE_SPECIFIER_PATTERN)) {
        const specifier = match[1];
        if (!specifier || specifier.startsWith(".") || specifier.startsWith("/")) {
          continue;
        }
        if (specifier.startsWith("node:")) {
          continue;
        }
        const packageName = toBarePackageName(specifier);
        if (isPackagedRuntimeModuleName(packageName)) {
          names.add(packageName);
        }
      }
    }
  }
  return [...names].sort();
}

function readPackagedPackageJson(asarPath, modulePath) {
  try {
    const packageJson = JSON.parse(
      asar.extractFile(asarPath, `node_modules/${modulePath}/package.json`).toString("utf8"),
    );
    // 包内 package.json 没有 name 时按“没打进包”处理：dist/cjs、umd 之类的目录里
    // 只写 {"type":"commonjs"} 的模块类型标记也可能被当成包根复制进去，
    // 认这种桩文件会让校验一路放过坏包，安装包照样启动失败。
    if (typeof packageJson?.name !== "string") {
      return null;
    }
    return packageJson;
  } catch {
    // asar 里没有这个路径（或该包被 asarUnpack 拆到 app.asar.unpacked 且读取失败）时按缺失处理。
    return null;
  }
}

function isRangeSatisfied(version, range) {
  if (!range) {
    return true;
  }
  try {
    return semver.satisfies(version, range, { includePrerelease: true });
  } catch {
    // workspace:*、file:、catalog: 等非 semver 写法无法比对，按“可用”放过，交给运行时暴露。
    return true;
  }
}

/**
 * 按产物实际内容判定运行时依赖缺口，供 afterPack 注入与 bundle 校验共用同一口径。
 *
 * 判定分两层，缺一层都会把坏包放出去：
 * 1. 以磁盘解析结果的相对层级（<pkg> 或 <父包>/node_modules/<dep>）为位置，
 *    包内该位置没有 package.json、或 package.json 缺 name、或版本不满足父包声明的范围，
 *    就把磁盘上的那份完整目录复制到同层位置。
 * 2. 顶层被别的消费者 hoisted 成旧版本时，父包需要的正确版本在磁盘上就是嵌套副本，
 *    electron-builder 不收这批嵌套，安装包启动即停在 Startup preparation failed——
 *    node-llama-cpp 要 lifecycle-utils@^4.5.2、顶层却是 2.1.0 就是这个例子，
 *    表现为 ESM 具名导入 SyntaxError: does not provide an export named ...。
 *
 * 自动闭包只遍历硬依赖（dependencies），不碰 optionalDependencies：后者由
 * desktop-native-package-policy 按目标平台裁剪，当成缺失补回去会把 12 套跨平台
 * llama.cpp 预编译物重新塞进包里顶穿 audit-bundle-size 的产物上限。
 */
export function resolvePackagedRuntimeDependencies({
  desktopRoot,
  manualModuleNames,
  moduleLookupRoots,
  asarPath,
}) {
  const autoModuleNames = discoverDesktopRuntimeModuleNames(desktopRoot);
  const closureEntries = [
    ...collectRuntimeModuleClosureEntries(manualModuleNames, moduleLookupRoots),
    ...collectRuntimeModuleClosureEntries(autoModuleNames, moduleLookupRoots, {
      includeOptionalDependencies: false,
    }),
  ];

  const entries = closureEntries;

  const missing = [];
  const unresolvable = [];
  const plannedByRelPath = new Map();

  for (const entry of entries) {
    const { moduleName, requiredRange } = entry;
    if (!entry.sourceModulePath) {
      unresolvable.push(entry);
      continue;
    }

    // 以磁盘解析结果的相对层级作为包内位置：顶层依赖就放顶层，
    // pnpm 已经嵌套的版本冲突副本就放到同样的父包名下，与 Node 运行时的查找顺序一致。
    const targetRelPath = entry.sourceRelDir ?? moduleName;
    const packaged = readPackagedPackageJson(asarPath, targetRelPath);
    if (packaged && isRangeSatisfied(packaged.version, requiredRange)) {
      continue;
    }

    const plannedSource = plannedByRelPath.get(targetRelPath);
    if (plannedSource) {
      if (plannedSource !== entry.sourceModulePath) {
        console.warn(
          `[runtime-deps] ${targetRelPath} 有两个不同版本争同一个位置（${plannedSource} 与 ${entry.sourceModulePath}），` +
            `保留先登记的那个，被 ${moduleName} 依赖的版本可能不满足 ${requiredRange}`,
        );
      }
      continue;
    }

    plannedByRelPath.set(targetRelPath, entry.sourceModulePath);
    missing.push({ ...entry, targetRelPath });
  }

  return { autoModuleNames, entries, unresolvable, missing };
}
