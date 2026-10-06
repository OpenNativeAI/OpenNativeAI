# OpenNativeAI 本地数据目录（`~/.opennativeai`）

> 数据根目录 = `~/.opennativeai`（可由 `OPENNATIVEAI_DATA_BASE_DIR` 改基路径）。
> 本文重点讲**桌面端（Electron）拥有哪些文件夹、每个文件和文件夹里到底存什么**，
> 所有内容为实机核查结果，敏感值一律不摘录。

## 一、桌面端拥有的目录：`v2/` 与 `computer-use/`

一句话归属：**`v2/` = 桌面端的"配置+历史+诊断"总目录；`computer-use/` = 桌面端安装的屏幕操作辅助 app。**
桌面端进程（main/renderer/Host）不往 `cli/` 写业务数据，`cli/` 是 Agent 的（见第三章）。

### 1.1 桌面端完整目录树（实机结构，逐项注释）

```text
~/.opennativeai/
├── v2/                                ← 桌面端配置与状态目录（代码中称 AppConfigDir）
│   ├── setting.json                   ← 应用设置（40+ 键，见 1.2）
│   ├── credentials.json               ← 登录凭据（600 权限）
│   ├── provider_config.json           ← 模型供应商配置
│   ├── config.json                    ← 旧版配置，只存 { provider: ... }，仅供迁移读取
│   ├── tasks-index.sqlite             ← 任务索引库（+ -shm/-wal 为 SQLite 运行伴生文件）
│   ├── telemetry-state.json           ← 遥测状态：deviceMid（设备标识）+ lastDailyActiveDate（日活日期）
│   ├── onboarding-record.json         ← 新手引导记录：version + deviceMid + entries（完成过的引导步骤）
│   ├── bot-state.v2.json              ← 遗留：bot 列表（{ version, bots: {} }，已空）
│   ├── bots-model-cache.v2.json       ← 遗留：bot 模型缓存（{ version, updatedAt, workspaceConfigOptions }）
│   ├── coding-plan-cache.json         ← 遗留：编码计划缓存（{ version, entryStatus }）
│   ├── certs/                         ← 本地网络 CA
│   │   ├── opennativeai-network-ca.pem       ← CA 证书（公钥，可分发）
│   │   └── opennativeai-network-ca.key       ← CA 私钥（600 权限，⚠ 绝不外传）
│   ├── checkpoints/                   ← Git checkpoint（撤销/回滚功能的状态）
│   │   └── {workspaceHash12}/         ← 每个工作区一个目录（SHA-256 前 12 位）
│   │       ├── state.json             ← 记录 workspacePath、workspaceKey、最近一次接受的 manifest 指针
│   │       ├── manifests/             ← 已接受的 checkpoint 清单（当前为空 = 还没打过快照）
│   │       ├── pending/               ← 等待用户确认的清单
│   │       └── tmp/                   ← 写入中间态
│   ├── crash/                         ← Electron CrashReporter 崩溃采集
│   │   ├── live/new|pending|completed/← 崩溃报告生命周期目录（当前全空 = 没崩过）
│   │   ├── live/attachments/          ← 崩溃现场附件（截图、日志）
│   │   ├── live/settings.dat          ← CrashReporter 二进制设置（Electron 内部格式）
│   │   └── archive/                   ← 历史归档
│   ├── logs/                          ← ★ 桌面端日志（main + renderer 都写这里）
│   │   └── YYYY-MM-DD.log             ← 按天一个文件；格式：[时间] [级别] [pid] [main/network/resource…] 消息
│   └── runtime/
│       └── provider/
│           ├── bundled/opennativeai-builtin.json      ← 内置官方供应商配置模板（随 app 分发）
│           └── darwin-aarch64/3.14.0/          ← 按「平台/架构/版本」物化的供应商运行时
│               └── endpoint-*/                 ← 解析并落盘的远端 Endpoint 配置（连接地址等）
└── computer-use/                      ← 桌面端 CUA 辅助
    ├── OpenNativeAI Computer Use.app/        ← 独立签名的 macOS 辅助 app（约 124M）
    │   └── Contents/
    │       ├── MacOS/OpenNativeAI Computer Use        ← 可执行文件
    │       └── Resources/ax_native.node        ← 无障碍操作原生模块 + node_modules
    ├── .opennativeai-cua-helper-meta.json    ← 安装版本戳（provider/version/buildId/bundleId/签名团队）
    └── .opennativeai-cua-helper-install.lock ← 安装互斥锁（防并发安装）
```

### 1.2 桌面端核心文件里具体存什么

| 文件                                                   | 实际存储内容（实机核查）                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `v2/setting.json`                                      | 全部用户偏好与 UI 状态：`recentProjects`（最近项目列表）、`locale`（语言）、`memoryEnabled`（记忆开关）、`lastWorkspaceSession`/`lastActiveTabIndex`（上次打开的会话和标签）、`desktopWindowSize`（窗口尺寸）、`closeToTrayOnWindows`、`keepAwakeWhileRunning`、`autoDownloadAndInstallUpdates`（更新设置）、`messageStreamShowReasoning`/`ShowTodos`（消息流显示）、`toolGrouping*`（工具分组）、`providerFamily*`（供应商家族/域名）、各 `*MigrationInitialized`（一次性迁移标记） |
| `v2/credentials.json`                                  | 键值对形式的加密凭据，键名即用途：`oauth:zai:access_token`、`oauth:active_provider`、`opennativeaijwttoken`、`account-provider:...:api-key`（值为密文，权限 600）。**桌面端登录态的唯一本地存储**                                                                                                                                                                                                                                                                                           |
| `v2/provider_config.json`                              | `{ schemaVersion, config }`——用户手动配置的模型供应商（自定义 endpoint/key），桌面 Host 在拉起 Agent 前写好，Agent 只读                                                                                                                                                                                                                                                                                                                                                              |
| `v2/tasks-index.sqlite`                                | 9 张表：`tasks`（任务元数据：workspace_key、title、status、mode、model、pinned、时间戳——**只存索引不存消息正文**）、`task_groups`/`task_group_members`/`task_group_view_node_orders`（任务分组与排序）、`automations`/`automation_runs`（自动化及运行记录）、`off_peak_tasks`（错峰任务）                                                                                                                                                                                            |
| `v2/logs/*.log`                                        | 桌面端 main/renderer 的结构化文本日志，含网络性能、资源刷新、生命周期事件——**排查桌面端问题第一入口**                                                                                                                                                                                                                                                                                                                                                                                |
| `v2/runtime/provider/darwin-aarch64/{版本}/endpoint-*` | 供应商 Endpoint Source 解析结果物化（连接地址、可用模型入口等），按平台+架构+app 版本隔离                                                                                                                                                                                                                                                                                                                                                                                            |

注：`v2/sessions/`（旧任务快照 `{taskId}.json`）是 legacy 路径，本机**不存在**——只有历史版本
升级迁移时才会生成；现在的会话事实都在 `cli/db/db.sqlite`（Agent 侧）。

### 1.3 桌面端与设置页「本地存储位置」的关系

设置 → 记忆 →「本地存储位置」显示的就是 `~/.opennativeai` 根目录；点击后由桌面 main 进程
`openPathInFileManager()`（`packages/desktop/src/main/desktopMainIpcHelpers.ts`）打开 Finder。
路径由 `IMemoryService.getLocalStorageRoot()`（Host 侧）提供，返回前幂等 `mkdir` 保证可打开。

## 二、桌面端"拉起"但不拥有的目录：`cli/`

`cli/` 由 Agent CLI 运行时写入（桌面端只负责经 stdio 把它拉起来，数据归属 Agent）：

- `db/db.sqlite` — 会话/消息主数据库；`log/` — **Agent 日志**（与桌面端 `v2/logs` 是两条链路）
- `rollout/`、`debug/` — 模型 I/O 轨迹（正式版写 rollout，dev 写 debug）
- `exec/`、`artifacts/` — 命令执行输出、超大工具结果落盘
- `memories/projects/` — Project Memory Markdown
- `plugins/` — 插件缓存与每插件私有数据

## 三、其他

- `workspace/default/` — 非项目对话的工作目录（Agent 的 cwd，当前为空）
- `plugin-workspace/` — 预留，当前为空

## 快速定位口诀

| 问题类型                        | 先看哪里                                                                 |
| ------------------------------- | ------------------------------------------------------------------------ |
| 桌面端崩溃 / 卡死 / 权限 / 更新 | `v2/logs/`、`v2/crash/`                                                  |
| 登录掉了 / 供应商配置不对       | `v2/credentials.json`、`v2/provider_config.json`、`v2/runtime/provider/` |
| 任务列表 / 分组 / 自动化状态    | `v2/tasks-index.sqlite`                                                  |
| 用户偏好（语言、开关、窗口）    | `v2/setting.json`                                                        |
| 屏幕操作（CUA）不可用           | `computer-use/` + `v2/logs/`                                             |
| 会话消息内容 / 模型调用异常     | `cli/db`、`cli/log`、`cli/rollout`（Agent 侧）                           |

路径定义源码：`packages/services/src/paths.ts`（桌面端侧）、
`apps/opennativeai-cli/packages/bootstrap/src/app/paths.ts`（Agent 侧）。
