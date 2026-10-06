import fs from "node:fs/promises";
import type { LocalEngineStatus } from "@opennativeai/shared";
import type {
  ILocalEngineService,
  IProviderSettingsService,
  ISettingService,
} from "@opennativeai/services";
import { createServiceLogger } from "@opennativeai/services/node";
import { LocalLlamaEngine } from "./engine.js";
import { startOpenAiServer, type OpenAiServerHandle } from "./openaiServer.js";

/** 注册进 provider registry 时展示的本地引擎供应商名。 */
const LOCAL_ENGINE_PROVIDER_NAME = "本地文本引擎";

/**
 * 本地 OpenAI 兼容服务监听的固定端口。
 * provider baseUrl 随 registry 落盘持久化，固定端口保证跨进程重启后持久化的 baseUrl 仍指向有效服务，
 * 避免随机端口重启即失效导致 CLI 打到死端口（表现为 empty_model_response）。被占用时服务自动回退随机端口。
 */
const LOCAL_ENGINE_PORT = 43117;

export interface LocalEngineServiceDeps {
  settingService: ISettingService;
  providerSettingsService: IProviderSettingsService;
}

interface EngineParams {
  modelPath: string;
  contextLength: number;
  threads: number;
  gpuEnabled: boolean;
  keepInMemory: boolean;
  temperature: number;
  providerId?: string;
}

/**
 * 本地文本引擎生命周期服务（只在桌面本地 Host 进程实例化）。
 *
 * start：加载 GGUF → 起 127.0.0.1 OpenAI 兼容服务 → 注册为 Personal Provider，
 * 使该模型进入模型下拉并可由现有 CLI HTTP provider 执行链真正对话。
 * stop：移除 provider + 关闭 HTTP 服务 + 释放模型原生资源。
 *
 * start/stop 串行化，避免用户快速切换开关导致重复注册或资源泄漏。
 */
export function createLocalEngineService(deps: LocalEngineServiceDeps): ILocalEngineService {
  const logger = createServiceLogger("local-engine");
  let engine: LocalLlamaEngine | undefined;
  let server: OpenAiServerHandle | undefined;
  let status: LocalEngineStatus = { state: "idle", running: false };
  // 单一操作队列：保证同一时刻只有一个 start/stop 在跑。
  let operation: Promise<LocalEngineStatus> = Promise.resolve(status);

  async function readEngineParams(): Promise<EngineParams> {
    const settings = await deps.settingService.get();
    return {
      modelPath: settings.localEngineModelPath?.trim() ?? "",
      contextLength: settings.localEngineContextLength ?? 4096,
      threads: settings.localEngineThreads ?? 4,
      gpuEnabled: settings.localEngineGpuEnabled ?? true,
      keepInMemory: settings.localEngineKeepInMemory ?? false,
      temperature: settings.localEngineTemperature ?? 0.7,
      providerId: settings.localEngineProviderId?.trim() || undefined,
    };
  }

  /** 把引擎服务注册成 Personal Provider；返回 providerId（失败返回 undefined）。 */
  async function registerProvider(
    baseUrl: string,
    modelId: string,
    contextLength: number,
  ): Promise<string | undefined> {
    let providerId: string;
    try {
      const created = await deps.providerSettingsService.createPersonalProvider({
        providerName: LOCAL_ENGINE_PROVIDER_NAME,
        initialConfig: {
          api: { type: "openai-chat-completions", baseUrl },
          access: { type: "api-key", apiKey: "local" },
        },
      });
      providerId = created.providerId;
      // useRecommendedConfig 补齐 maxOutputTokens 等执行所需字段，使模型 executable 出现在下拉。
      await deps.providerSettingsService.addPersonalModel(
        providerId,
        modelId,
        { enabled: true, properties: { contextWindow: contextLength } },
        true,
      );
      // 记录 providerId 作为唯一所有者，供 stop / 重启精确清理，避免孤儿 provider。
      await deps.settingService.update({ localEngineProviderId: providerId });
    } catch (error) {
      logger.error("本地文本引擎 provider 注册失败", error);
      return undefined;
    }
    // refresh 仅用于拉取完整 registry（含云端下发配置）；
    // 本地 dev 环境内置云端配置端点不可达时 refresh 会抛错，但不应回滚已成功的本地 provider 注册。
    try {
      await deps.providerSettingsService.refresh("local-engine-start");
    } catch (error) {
      logger.warn("本地文本引擎 registry 刷新失败（本地 provider 已注册，忽略）", error);
    }
    return providerId;
  }

  async function removeProvider(providerId: string | undefined): Promise<void> {
    if (!providerId) {
      return;
    }
    try {
      await deps.providerSettingsService.deletePersonalProvider(providerId);
      await deps.providerSettingsService.refresh("local-engine-stop");
    } catch (error) {
      // 重启后 provider 可能已被用户手动删除，清理失败不应阻断 stop。
      logger.warn(`本地文本引擎 provider 清理失败(${providerId})`, error);
    }
    await deps.settingService.update({ localEngineProviderId: undefined });
  }

  async function releaseRuntime(): Promise<void> {
    if (server) {
      await server
        .close()
        .catch((error: unknown) => logger.warn("关闭本地引擎 HTTP 服务失败", error));
      server = undefined;
    }
    if (engine) {
      await engine
        .dispose()
        .catch((error: unknown) => logger.warn("释放本地引擎模型资源失败", error));
      engine = undefined;
    }
  }

  /**
   * 扫掉所有遗留的引擎 provider（含早期 bug 产生、id 未被记录的孤儿）。
   * 同时按名称前缀 + 127.0.0.1 baseUrl 两个条件命中，避免误删用户自建的本地 provider。
   */
  async function sweepStaleEngineProviders(): Promise<void> {
    try {
      const view = await deps.providerSettingsService.getView();
      const stale = view.providers.filter(
        (provider) =>
          provider.providerName?.startsWith(LOCAL_ENGINE_PROVIDER_NAME) &&
          provider.effectiveConfig.api?.baseUrl?.startsWith("http://127.0.0.1"),
      );
      for (const provider of stale) {
        await deps.providerSettingsService.deletePersonalProvider(provider.providerId);
      }
      if (stale.length > 0) {
        logger.info(`启动前清理了 ${stale.length} 个遗留的本地引擎 provider`);
      }
    } catch (error) {
      logger.warn("清理遗留本地引擎 provider 失败", error);
    }
  }

  async function startInternal(): Promise<LocalEngineStatus> {
    if (status.running && server && engine) {
      return status;
    }
    // 首版仅 macOS：node-llama-cpp 预编译 Metal 二进制当前只覆盖 macOS 平台。
    if (process.platform !== "darwin") {
      status = { state: "unsupported", running: false, error: "本地文本引擎当前仅支持 macOS" };
      return status;
    }
    const params = await readEngineParams();
    if (!params.modelPath) {
      status = { state: "error", running: false, error: "请先在设置中选择本地 GGUF 模型文件路径" };
      return status;
    }
    try {
      await fs.access(params.modelPath);
    } catch {
      status = { state: "error", running: false, error: `模型文件不存在：${params.modelPath}` };
      return status;
    }

    status = { state: "starting", running: false };
    // 重复启动或 host 重启：先扫掉所有遗留的引擎 provider（含历史 bug 孤儿），保证最终只注册一个。
    await sweepStaleEngineProviders();
    await deps.settingService.update({ localEngineProviderId: undefined });

    try {
      const nextEngine = new LocalLlamaEngine({
        modelPath: params.modelPath,
        contextLength: params.contextLength,
        threads: params.threads,
        gpuEnabled: params.gpuEnabled,
        keepInMemory: params.keepInMemory,
      });
      await nextEngine.load({
        modelPath: params.modelPath,
        contextLength: params.contextLength,
        threads: params.threads,
        gpuEnabled: params.gpuEnabled,
        keepInMemory: params.keepInMemory,
      });
      engine = nextEngine;

      server = await startOpenAiServer({
        engine: nextEngine,
        modelId: nextEngine.modelId,
        defaultTemperature: params.temperature,
        port: LOCAL_ENGINE_PORT,
        onError: (error, context) => logger.error(`本地引擎 HTTP 服务错误(${context})`, error),
        debug: (message, data) => logger.debug(message, data),
        onEmpty: (summary) => logger.warn("本地引擎返回空内容", summary),
      });

      const providerId = await registerProvider(
        server.baseUrl,
        nextEngine.modelId,
        params.contextLength,
      );
      if (!providerId) {
        await releaseRuntime();
        status = { state: "error", running: false, error: "本地模型注册到供应商列表失败" };
        return status;
      }
      status = {
        state: "running",
        running: true,
        baseUrl: server.baseUrl,
        providerId,
        modelId: nextEngine.modelId,
        info: nextEngine.getInfo(),
      };
      logger.info(
        `本地文本引擎已启动：${server.baseUrl} provider=${providerId} model=${nextEngine.modelId}`,
      );
      return status;
    } catch (error) {
      await releaseRuntime();
      const message = error instanceof Error ? error.message : String(error);
      logger.error("本地文本引擎启动失败", error);
      status = { state: "error", running: false, error: message };
      return status;
    }
  }

  async function stopInternal(): Promise<LocalEngineStatus> {
    const params = await readEngineParams();
    await removeProvider(params.providerId ?? status.providerId);
    await releaseRuntime();
    status = { state: "idle", running: false };
    logger.info("本地文本引擎已停止");
    return status;
  }

  function enqueue(fn: () => Promise<LocalEngineStatus>): Promise<LocalEngineStatus> {
    const next = operation.then(fn, fn);
    // 队列吞掉 rejection，避免一次失败阻断后续开关操作。
    operation = next.catch(() => status);
    return next;
  }

  /**
   * 开机初始化：provider 会随 registry 持久化，但服务进程（HTTP + 模型）不会。
   * host 重启后若不同步恢复，就会出现“开关显示已启用、下拉有 provider，但 baseUrl 指向已死端口”的不一致。
   * 因此：启用状态下后台自动恢复（顺带清扫历史孤儿 provider）；未启用但残留脏 provider 时只清扫。
   */
  async function bootstrap(): Promise<void> {
    try {
      const settings = await deps.settingService.get();
      if (settings.localEngineEnabled) {
        await enqueue(startInternal);
      } else {
        await sweepStaleEngineProviders();
      }
    } catch (error) {
      logger.warn("本地文本引擎开机初始化失败", error);
    }
  }

  // 后台启动，不阻塞 host 引导；startInternal 内部已处理失败并回写状态。
  void bootstrap();

  return {
    start: () => enqueue(startInternal),
    stop: () => enqueue(stopInternal),
    // 运行时详情（内存占用等）会随推理变化，getStatus 每次从引擎取最新快照，不缓存为第二份事实源。
    getStatus: async () =>
      status.running && engine ? { ...status, info: engine.getInfo() } : status,
  };
}
