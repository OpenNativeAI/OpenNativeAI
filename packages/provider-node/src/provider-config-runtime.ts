import {
  ProviderConfigService,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@opennativeai/provider";
import { NodeOpenNativeAIBuiltinProviderConfigSource } from "./opennativeai-builtin-provider-config-source.js";
import {
  EndpointScopedOpenNativeAIBuiltinSource,
  type EndpointScopedOpenNativeAIBuiltinSourceOptions,
} from "./endpoint-scoped-opennativeai-builtin-source.js";
import {
  OpenNativeAIBuiltinRemoteSynchronizer,
  type OpenNativeAIBuiltinRemoteSynchronizerOptions,
  type OpenNativeAIBuiltinRefreshResult,
} from "./opennativeai-builtin-remote-synchronizer.js";
import {
  NodePersonalProviderConfigRepository,
  type PersonalProviderConfigRecoveryEvent,
} from "./personal-provider-config-repository.js";

export interface NodeProviderConfigRuntimeOptions {
  readonly opennativeaiBuiltinFilePath: string;
  readonly opennativeaiBuiltinActiveFilePath?: string;
  readonly opennativeaiBuiltinRemote?: Omit<OpenNativeAIBuiltinRemoteSynchronizerOptions, "source">;
  readonly opennativeaiBuiltinEnvironment?: Omit<
    EndpointScopedOpenNativeAIBuiltinSourceOptions,
    "bundledFilePath"
  >;
  readonly onOpenNativeAIBuiltinRefreshError?: (error: unknown) => void;
  readonly onPersonalConfigRecovery?: (event: PersonalProviderConfigRecoveryEvent) => void;
  readonly onPersonalConfigPollingError?: (error: unknown) => void;
  readonly personalFilePath: string;
  readonly personalPollingIntervalMs?: number | false;
  readonly importLegacy?: (
    opennativeaiBuiltin: ProviderConfigLayerSnapshot,
  ) => Promise<ProviderConfigLayerUpdate | null>;
  readonly watch?: boolean;
}

/** 组装一个 Node.js 进程内共享的 OpenNativeAI Built-in/Personal Config 运行边界。 */
export class NodeProviderConfigRuntime {
  readonly configService: ProviderConfigService;
  readonly #opennativeaiBuiltinSource:
    | NodeOpenNativeAIBuiltinProviderConfigSource
    | EndpointScopedOpenNativeAIBuiltinSource;
  readonly #personalRepository: NodePersonalProviderConfigRepository;
  readonly #remoteSynchronizer?: OpenNativeAIBuiltinRemoteSynchronizer;
  readonly #onRemoteRefreshError?: (error: unknown) => void;
  #startPromise: Promise<void> | null = null;
  #disposed = false;
  readonly #checkListeners = new Set<() => Promise<void>>();
  #checkTimer: ReturnType<typeof setInterval> | null = null;
  #checkInFlight: Promise<void> | null = null;

  constructor(options: NodeProviderConfigRuntimeOptions) {
    this.#opennativeaiBuiltinSource = options.opennativeaiBuiltinEnvironment
      ? new EndpointScopedOpenNativeAIBuiltinSource({
          bundledFilePath: options.opennativeaiBuiltinFilePath,
          ...options.opennativeaiBuiltinEnvironment,
        })
      : new NodeOpenNativeAIBuiltinProviderConfigSource({
          bundledFilePath: options.opennativeaiBuiltinFilePath,
          activeFilePath: options.opennativeaiBuiltinActiveFilePath,
          watch: options.watch,
        });
    this.#remoteSynchronizer =
      options.opennativeaiBuiltinRemote &&
      this.#opennativeaiBuiltinSource instanceof NodeOpenNativeAIBuiltinProviderConfigSource
        ? new OpenNativeAIBuiltinRemoteSynchronizer({
            source: this.#opennativeaiBuiltinSource,
            ...options.opennativeaiBuiltinRemote,
          })
        : undefined;
    this.#onRemoteRefreshError = options.onOpenNativeAIBuiltinRefreshError;
    this.#personalRepository = new NodePersonalProviderConfigRepository({
      filePath: options.personalFilePath,
      onRecovery: options.onPersonalConfigRecovery,
      onPollingError: options.onPersonalConfigPollingError,
      pollingIntervalMs: options.personalPollingIntervalMs,
      ...(options.importLegacy
        ? {
            importLegacy: async () => options.importLegacy!(await this.#opennativeaiBuiltinSource.read()),
          }
        : {}),
    });
    this.configService = new ProviderConfigService({
      opennativeaiBuiltinSource: this.#opennativeaiBuiltinSource,
      personalRepository: this.#personalRepository,
    });
  }

  resolveOpenNativeAIBuiltinActiveFilePath(): Promise<string> {
    return this.#opennativeaiBuiltinSource instanceof NodeOpenNativeAIBuiltinProviderConfigSource
      ? Promise.resolve(this.#opennativeaiBuiltinSource.activeFilePath)
      : this.#opennativeaiBuiltinSource.resolveActiveFilePath();
  }

  get personalRepository(): import("@opennativeai/provider").PersonalProviderConfigRepository {
    return this.#personalRepository;
  }

  /** Environment 同一周期检查中恢复未对齐依赖，不被下载 TTL 或失败挡住。 */
  onDidCheckOpenNativeAIBuiltin(listener: () => Promise<void>): () => void {
    this.#checkListeners.add(listener);
    return () => this.#checkListeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.#disposed) throw new Error("NodeProviderConfigRuntime 已 dispose");
    if (this.#startPromise) return this.#startPromise;
    const startPromise = this.configService.read().then(() => {
      if (this.#disposed) return;
      void this.#checkBackground();
      // Managed Worker 无下载配置也无恢复 owner，不建立周期任务。
      if (
        this.#remoteSynchronizer ||
        this.#opennativeaiBuiltinSource instanceof EndpointScopedOpenNativeAIBuiltinSource ||
        this.#checkListeners.size > 0
      ) {
        this.#checkTimer = setInterval(() => {
          void this.#checkBackground();
        }, 60_000);
        this.#checkTimer.unref?.();
      }
    });
    this.#startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.#startPromise === startPromise) this.#startPromise = null;
    });
    return startPromise;
  }

  refreshOpenNativeAIBuiltin(options?: { readonly force?: boolean }): Promise<OpenNativeAIBuiltinRefreshResult> {
    if (this.#disposed) return Promise.resolve("disposed");
    if (this.#opennativeaiBuiltinSource instanceof EndpointScopedOpenNativeAIBuiltinSource) {
      return this.#opennativeaiBuiltinSource.refresh(options);
    }
    return this.#remoteSynchronizer?.refresh(options) ?? Promise.resolve("skipped");
  }

  #checkBackground(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#checkInFlight) return this.#checkInFlight;
    const check = Promise.allSettled([
      this.refreshOpenNativeAIBuiltin(),
      ...[...this.#checkListeners].map((listener) => Promise.resolve().then(listener)),
    ])
      .then((results) => {
        if (this.#disposed) return;
        for (const result of results)
          if (result.status === "rejected") this.#onRemoteRefreshError?.(result.reason);
      })
      .finally(() => {
        if (this.#checkInFlight === check) this.#checkInFlight = null;
      });
    this.#checkInFlight = check;
    return check;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#checkTimer) clearInterval(this.#checkTimer);
    this.#checkTimer = null;
    this.#checkListeners.clear();
    this.#remoteSynchronizer?.dispose();
    this.configService.dispose();
    this.#personalRepository.dispose();
    this.#opennativeaiBuiltinSource.dispose();
  }
}

export function createNodeProviderConfigRuntime(
  options: NodeProviderConfigRuntimeOptions,
): NodeProviderConfigRuntime {
  return new NodeProviderConfigRuntime(options);
}
