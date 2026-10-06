# Media Studio（图像/视频生成）Spec

状态：已对齐（2026-09-22 用户决策）
范围：Desktop Host + Renderer；独立界面、独立存储、不接入会话/分享/回放链路。

## 1. 产品规则

- Media Studio 是**独立功能面**：独立 workspace 主视图（与 automations/plugin-store 同级）、
  独立存储目录、独立服务通道。
- 不与编码会话交互：生成记录**不写入** `cli/db`、不产生会话 artifact 行、不参与会话分享与远控回放。
- 计费操作防护：每次提交生成任务前，UI 展示预估提示（文生图/文生视频为付费 API 调用）；
  当前选中模态的配置缺失（无 baseUrl/key/model）时提交按钮不可用。
- 平台门控：服务仅注册于 Host 进程；accessor 中字段为可选，无服务的宿主（纯 Web 无 Host、
  旧 Host 构建）显示「当前环境不可用」空态，不崩溃。

## 2. 状态所有者

唯一所有者：Host 进程内的 `IMediaStudioService`（`packages/services/src/media-studio/`）。
Renderer 只是投影：通过 RPC 读任务列表、提交任务、删除任务；**不持有任务状态副本**，
列表刷新采用「事件触发 + 轮询兜底（2s，仅当存在 running 任务时）」，轮询停止条件明确。

存储（全部位于独立目录，不触碰既有目录；图像与视频物理隔离，各自独立目录树）：

```text
~/.opennativeai/media-studio/
├── image/                   # 图像模态：配置、任务索引、产物全部独立
│   ├── config.json          # 600：{ baseUrl, apiKey, model }
│   ├── jobs.json            # 600：仅 kind=image 的任务索引
│   └── files/{jobId}.png
└── video/                   # 视频模态：同上，与 image/ 互不混放
    ├── config.json          # 600：{ baseUrl, apiKey, model }
    ├── jobs.json            # 600：仅 kind=video 的任务索引
    └── files/{jobId}.mp4
```

旧布局（根下扁平 config.json / jobs.json / files/）在 Host 启动时由
`mediaStudioLayout.migrateLegacyMediaStudioLayout` 迁移一次（幂等）：配置按模态
拆为两份独立文件；任务索引按 kind 拆分；产物文件搬移到各模态 files/ 并更新记录中的绝对路径。

## 3. 接口（IMediaStudioService）

- `getConfig(): Promise<{ image: ProviderView; video: ProviderView } | null>`（ProviderView = { baseUrl, model, apiKeyMasked, hasApiKey }；完全未配置返回 null）
- `saveConfig(config): Promise<void>`（分别写入 `image/config.json` 与 `video/config.json`，权限 600；apiKey 明文存于独立目录，独立于 credentials.json，保持功能隔离；某模态 apiKey 传空串时沿用该模态已存的 key）
- `listJobs(): Promise<MediaJobSummary[]>`
- `createJob(input: { kind: "image" | "video"; prompt; size?; }): Promise<MediaJobSummary>`
- `deleteJob(jobId): Promise<void>`（删索引行 + 文件）
- `readJobFileDataUrl(jobId): Promise<string | null>`（Renderer 预览用 data URL，避免 file:// 权限问题）
- `getStorageRoot(): Promise<string>`（设置页「多模态」分区展示存储目录与文件管理器打开用）

## 4. 事件顺序（所有者视角）

```text
Renderer ──createJob──▶ Service
Service：写 {kind}/jobs.json(status=submitting) ──POST {config[kind].baseUrl}/{images|videos}/generations──▶ Provider
  ├─ image：同步返回 b64_json/url → 落盘 image/files/{id}.png → status=succeeded
  └─ video：返回 task id → 记 remoteTaskId，status=running，启动后台轮询
       轮询 GET {baseUrl}/videos/generations/{remoteTaskId}
         ├─ SUCCEEDED → 下载 video_url → 落盘 video/files/{id}.mp4 → status=succeeded
         ├─ FAILED    → status=failed + error
         └─ 进程重启   → 启动时对 running 任务按 remoteTaskId 恢复轮询（不重复提交，幂等边界）
Renderer：2s 轮询 listJobs，仅当存在 submitting/running 任务；全部终态后停止
```

失败语义：HTTP 非 2xx、轮询超时（视频 30 分钟上限，超时记 failed）、下载失败均记 `failed + error`，
不重试（重试=重复计费，禁止自动重试）。

## 5. UI（workspace 主视图「媒体」）

- 入口：侧栏导航列新增一行（与自动化/插件市场同级，`Clapperboard` 图标），切换
  `WorkspaceMainView` 为 `media-studio`；**不用独立 Tab 覆盖层**，侧栏与 workspace 壳层
  保持挂载（与 automations/plugin-store 主视图同一模式）。
- 布局：主视图由 `AutomationsMainBreadcrumbFrame` + `max-w-6xl` 宽容器包裹（画廊为浏览型内容）；
  桌面为「中间任务瀑布 + 右侧创作面板（sticky 320px）」，移动端单列、创作表单置顶。
  任务卡为 CSS 多列瀑布流（`columns-2/md:columns-3`）：产物按原生宽高比展示，不同格式
  （竖图/横图/方图/视频）紧凑拼合；提示词/模型/失败原因不占常驻文本区，仅 hover 遮罩展示；
  删除按钮 hover 出现；非终态/失败状态以左上角徽标常驻。创作面板含：类型切换、prompt、
  模型下拉（消费当前模态的 models 列表）、尺寸（仅图像）、计费提示与生成按钮。
- 配置读写唯一入口：设置页「多模态」分区（`settings.multimodal`，与 memory 同源读本地 Host）：
  参考「模型设置」形态，图像与视频各为一张独立供应商卡片（Base URL / API Key（明文切换+掩码占位）/ 模型，
  一行一字段、label 在上），单一保存按钮；另含多模态存储目录展示（点击路径打开文件管理器）。
  主视图只读配置做门控（按当前选中模态），未配置时提示并提供「去设置」按钮；保证配置单写入路径。
- 预览：图片用 data URL `<img>`；视频用 `<video controls>`；均不依赖会话附件组件。
- i18n：`mediaStudio.*` 命名空间 + `workspace.openMediaStudio`，中英齐全。

## 5.1 图生图（i2i，参考图输入）

仅对 image 模态开放；视频模态不支持参考图输入（与上游 video API 形态对齐）。

- **来源**：本地上传（拖拽 / 点选文件）+ 画廊产物复用（已有 succeeded 的图片点「作为参考图」）。
- **存储**：参考图不落盘——本来就是发送的本地图片，持久化只会重复占空间。提交时由 Renderer 读取并以 data URL 传给 Host，Host 仅在本次请求体内带到上游 API，绝不写入 `~/.opennativeai/media-studio`。
- **API 形态**：图生图协议按 provider `i2iMode` 分流，三种兜底：
  - `edits-multipart`（默认）：OpenAI / Azure gpt-image 系标准，`POST {baseUrl}/images/edits` + `multipart/form-data`，参考图作为 `image` 文件字段（PNG，从 data URL 解 base64），`model` / `prompt` / `size` 作为普通表单字段；`Content-Type` 由 fetch+FormData 自动生成 boundary。
  - `image-url-json`：legacy 风格，`POST {baseUrl}/images/generations` + JSON `image_url: <data-url>` 字段；部分中转站用。
  - `input-images-json`：Qwen 风格，`POST {baseUrl}/images/generations` + JSON `input_images: [data-url, ...]` 字段。
  - 仅 t2i 一律走 `POST {baseUrl}/images/generations`（JSON 请求体）。
    失败语义走现有 `failed + error`，不重试。
- **不覆盖的协议**：Gemini 系走原生多模态协议——本条当前不在本期范围；若后续接的供应商是这种，再加策略分支（按模型名或 provider 配置路由）。
- **任务记录**：仅记录 `hasReferenceImage: boolean` 与（仅画廊复用时）`referenceFromJobId: string` 两个轻量字段；不存图本身。Host 重启后尚未拿到响应的 image submitting 任务仍按既有逻辑直接 `failed: interrupted by host restart`，参考图无法续跑——这是「不持久化」的代价。
- **UI**：
  - 创作面板仅在 image 模态下展示参考图槽位；切到 video 时清空既有选择。
  - 槽位支持点击选文件与拖拽；展示缩略图 + 「移除」按钮；无参考图时显示虚线占位。
  - 画廊卡片 hover 时增加「作为参考图」入口（与删除按钮同坐标列）；点击后将该卡片的产物 data URL 灌入创作面板参考图槽位。
  - 任务卡片左上角徽标：若 `hasReferenceImage` 为真，加 `i2i` 小徽标（视频徽标同位置避让）。

## 6. 验收场景

1. 未配置时：提交按钮禁用，配置条提示缺失项。
2. 配置保存后 config.json 权限 600，重新进入视图回显（key 掩码显示）。
3. 图像任务：submitting → succeeded，网格出现缩略图，点击放大；带参考图时按 provider.i2iMode 分流——默认 `edits-multipart` 走 `POST /images/edits`（multipart，`image` 文件字段 + prompt/model/size 表单字段），`image-url-json` 走 `POST /images/generations` + JSON `image_url`，`input-images-json` 走 `POST /images/generations` + JSON `input_images`；任务记录 `hasReferenceImage=true`，参考图字节不落盘到 media-studio 目录。
4. 视频任务：running 期间网格显示进度态；成功后可播放；**重启 Host 后 running 任务恢复轮询**，不产生重复提交。
5. 删除任务：索引行与文件同时消失。
6. 会话链路零影响：`cli/db`、`v2/tasks-index.sqlite` 无新增行；会话分享/回放行为不变。
7. 无服务宿主：主视图显示不可用空态，无报错横幅。

## 7. 非目标（本期不做）

- 不接入 Agent 工具（聊天里不能调生成）；不做画廊分享；不做 Web 端 Host 之外的远端生成。
