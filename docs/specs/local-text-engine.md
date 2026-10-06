# 本地文本引擎（Local Text Engine）Spec

状态：已对齐（2026-10-02 用户决策）
范围：Desktop Host + Renderer；仅 macOS。引擎生命周期经 Host RPC（`ILocalEngineService`）暴露，Main 不承载引擎业务状态。

## 1. 背景（既有行为，本 spec 不重复实现）

- Host 用 `node-llama-cpp` 加载单个 GGUF，起仅监听 `127.0.0.1` 的 OpenAI 兼容服务（固定端口 43117，占用回退随机），注册为 Personal Provider，使本地模型进入模型下拉。
- 本地最小请求策略：本地引擎对每个请求只保留基础工具白名单、不带多轮历史，避免上下文溢出（详见 `engine.ts` 注释与 `common_pitfalls_experience` 记忆）。

## 2. 本次新增：运行时与模型详情展示

产品规则：设置面板「本地文本引擎」分区在引擎已加载时，展示一份**只读**的运行时/模型详情，帮助用户确认「模型是否真的进了内存、以什么方式进内存、当前占了多少、GPU/线程等运行时配置、模型本身是什么规格」。内存/占用等运行时指标需**动态刷新**，随推理变化而更新，而非打开面板时的一次性快照。

### 2.1 状态所有者与数据流

唯一所有者仍是 Host 进程内的引擎实例（`LocalLlamaEngine`）。详情数据由引擎在原生对象（`LlamaModel` / `LlamaContext`）上即时读取，**不落盘、不是第二份事实源**：

```
node-llama-cpp(LlamaModel/LlamaContext getters)
   └─ engine.getInfo()  →  LocalEngineModelInfo
        └─ localEngineService.getStatus() 合并进 LocalEngineStatus.info（每次查询取最新内存值）
             └─ Renderer（TextEngineSection）仅渲染 Host 返回值，不缓存、不改写
```

- Renderer 只在面板挂载时调用 `getStatus()` 读取初始快照；引擎 `running` 期间面板按固定间隔（约 2s）重新 `getStatus()` 拉取最新运行时值，卸载或停止后停止刷新，不本地保存引擎事实。
- `info` 仅在模型已加载（`running`）时存在；`idle/starting/error/unsupported` 时缺省，UI 不展示详情卡片。

### 2.2 字段（全部来自 node-llama-cpp 真实 getter，取不到则省略该字段）

| 字段 | 来源 | 含义 |
| --- | --- | --- |
| `loadedToMemory` | `model !== undefined` | 模型是否已加载进内存（原生资源已分配） |
| `residentLocked` | 引擎本次加载参数 `keepInMemory` | 本次是否以 mlock 强制常驻内存（回答“我现在是常驻内存吗”） |
| `usesMmap` | `model.useMmap` | 是否以 mmap 内存映射方式加载（true=按需映射，false=一次性全量读入物理内存） |
| `gpuActive` | `model.gpuLayers > 0` | GPU 加速是否实际生效（有层卸载到 GPU） |
| `flashAttention` | `context.flashAttention`（auto 时结合 `model.flashAttentionSupported` 判定） | 是否启用 Flash Attention |
| `vocabularyType` | `model.vocabularyType` | 词表类型（bpe/spm/…） |
| `supportedByLlamaCpp` | `model.fileInsights.isSupportedByLlamaCpp` | 当前 llama.cpp 运行时是否支持该模型 |
| `idealThreads` | `context.idealThreads` | 建议推理线程数 |
| `totalSequences` | `context.totalSequences` | 上下文可承载的并发序列总数 |
| `modelFileName` | `model.filename` | GGUF 文件名 |
| `displayName` | `model.fileInfo.metadata.general.name` | 模型显示名 |
| `architecture` | `model.architecture` | 架构（deepseek/qwen2/…） |
| `quantizationType` | `model.fileInsights.dominantTensorType` | 主张量量化类型 |
| `parameterCount` | `model.fileInsights.totalParameters` | 参数量 |
| `totalLayers` | `model.fileInsights.totalLayers` | 总层数 |
| `gpuLayers` | `model.gpuLayers` | offload 到 GPU 的层数 |
| `trainContextSize` | `model.trainContextSize` | 模型原生训练上下文 |
| `contextSize` | `context.contextSize` | 实际分配上下文长度 |
| `batchSize` | `context.batchSize` | 批处理大小 |
| `embeddingVectorSize` | `model.embeddingVectorSize` | 嵌入向量维度 |
| `modelSizeBytes` | `model.size` | 模型文件字节数 |
| `modelRamUsageBytes` | `model.memoryUsage.ram` | 模型权重占用 RAM |
| `modelVramUsageBytes` | `model.memoryUsage.vram` | 模型权重占用 VRAM |
| `contextRamUsageBytes` | `context.memoryUsage.ram` | 上下文（KV cache）占用 RAM |
| `contextVramUsageBytes` | `context.memoryUsage.vram` | 上下文（KV cache）占用 VRAM |
| `ramUsageBytes` | `model.ram + context.ram` | 合计占用 RAM（至少一侧可读时给出） |
| `vramUsageBytes` | `model.vram + context.vram` | 合计占用 VRAM（至少一侧可读时给出） |
| `threads` | `context.currentThreads` | 当前推理线程数 |
| `ggufVersion` | `model.fileInfo.version` | GGUF 版本 |

健壮性：任一 getter 抛错或返回 undefined（不同架构/量化文件差异）时，跳过该字段，不得让 `getInfo()` 整体失败或伪造数值。

### 2.3 UI 与格式化

- 只读展示，无输入控件；沿用 `SettingsGroupCard` 风格，字段以「标签 + 值」两列网格排布。
- 字节统一格式化为人读的 MB/GB（1024 进制，保留 1 位小数）；参数量格式化为 `xB` / `xM`。
- 布尔类字段（是否加载进内存、GPU 生效、Flash Attention、llama.cpp 支持）以明确的是/否文案展示，不用裸 true/false；`usesMmap` 用专用文案区分“内存映射（mmap）”与“全量载入内存”。
- 遵循 `DESIGN.md`：复用既有文本/间距 token，桌面与移动 Web 自适应换行。

## 3. 验收场景

1. 未启动引擎：详情卡片不出现，仅参数表单。
2. 启动成功（running）：详情卡片出现，`已加载进内存 = 是`，模型名/架构/量化/参数量/层数/上下文/RAM/VRAM/线程 等按真实值展示，缺项字段不显示占位假值。
3. 停止引擎：详情卡片消失。
4. 非 macOS / 无 Host 服务：不展示详情，不崩溃。
5. 跨窗口/重进面板：重新 `getStatus()` 取到最新内存值。
6. 引擎 `running` 期间面板保持打开：内存/RAM/VRAM/线程等运行时值按固定间隔自动刷新，体现推理过程中的动态变化。

## 4. 边界

- `info` 是运行时快照，不写 `setting.json`（引擎加载参数作为持久化设置，见§5）。
- 不做服务端主动推送：运行时值由面板在 `running` 期间以固定间隔（约 2s）轮询 `getStatus()` 刷新；面板卸载或引擎停止即停止轮询，不后台常驻定时器。
- 不承诺 GPU 显存精确值：`vram` 为 node-llama-cpp 估算，按其返回值展示。

## 5. 常驻内存（mlock）开关

背景：`node-llama-cpp` 默认 `useMmap: "auto"`（macOS 上通常开启 mmap），且**不设 `useMlock`**。这意味着模型文件是按需从磁盘页入内存，操作系统可能在闲置时逐出页——表现为首次使用/闲置后的“卡一下”。这既不是“已钉住常驻”，也不能保证随时最快。

产品规则：新增引擎加载参数开关 `localEngineKeepInMemory`（默认 **关**），开启时引擎以 `useMlock: true` 加载模型，**强制把模型页钉在 RAM/VRAM**，不被系统逐出。

- 唯一所有者：开关值持久化到 `AppSettings`（与 `localEngineGpuEnabled` 等加载参数同类），启动引擎时由 Host 读入并传给 `llama.loadModel({ useMlock })`；Renderer 不直接推理。
- 生效时机：与其它加载参数一致，**下次启动引擎时生效**（运行中不热加载）；UI 描述需标注这一点。
- 状态回显：`LocalEngineModelInfo.residentLocked` 由引擎记录本次加载是否开启 mlock，经 `getStatus().info` 回传，面板“常驻内存”行展示当前运行实例的实际值（回答“我现在是常驻内存吗”）。
- 诚实边界：mlock 主要消除“页缺失/被逐出”导致的卡顿，使模型随时就绪且推理稳定；**不会缩短首次 `loadModel` 读盘耗时**，且开启后模型固定占用 RAM，大模型可能因资源不足影响系统（node-llama-cpp 原文警告），因此默认关。
