import type { LocalEngineStatus } from "@opennativeai/shared";
import { ServiceChannels } from "@opennativeai/shared";
import { createServiceDescriptor } from "../descriptors.js";

/**
 * 本地文本引擎命令面。
 *
 * 引擎（node-llama-cpp）与 provider 注册都属于桌面本地 Host 的业务状态，因此经由 Host RPC 暴露，
 * 而不是走 main 进程的 IPlatformService —— Main 不承载 task/session/引擎这类业务状态。
 * Renderer 只触发命令并展示 Host 返回的状态快照，从不本地保存引擎事实。
 */
export interface ILocalEngineService {
  /** 读取当前引擎参数并加载模型、起本地 OpenAI 兼容服务、注册 provider；返回权威状态。 */
  start(): Promise<LocalEngineStatus>;
  /** 停止服务、释放模型并移除 provider；返回停止后的状态。 */
  stop(): Promise<LocalEngineStatus>;
  /** 查询当前状态（面板挂载或重连时补偿异步事件）。 */
  getStatus(): Promise<LocalEngineStatus>;
}

export const ILocalEngineService = createServiceDescriptor<ILocalEngineService>(
  ServiceChannels.LocalEngine,
);
