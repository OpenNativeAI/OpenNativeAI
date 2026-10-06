import { recordArmsCustomEventForE2E } from "@opennativeai/ui";
import {
  DesktopCommandIds,
  buildLocalMediaPreviewUrl,
  type IPlatformService,
} from "@opennativeai/shared";

import { desktopBrowserPlatformBridge } from "./desktopBrowserPlatformBridge.js";

export function createDesktopPlatform(options: {
  isLocalDevelopmentRuntime: boolean;
}): IPlatformService {
  return {
    canSelectFilePath: true,
    createLocalMediaPreviewUrl: buildLocalMediaPreviewUrl,
    isLocalDevelopmentRuntime: options.isLocalDevelopmentRuntime,
    selectDirectory: () => window.opennativeai.selectDirectory(),
    selectFile: () => window.opennativeai.selectFile(),
    selectFiles: () => window.opennativeai.selectFiles?.() ?? Promise.resolve([]),
    createTempTextAttachment: (payload) => window.opennativeai.createTempTextAttachment(payload),
    onRemoteConnectionLog: (handler) => window.opennativeai.onRemoteConnectionLog(handler),
    onRemoteSessionClosed: (handler) => window.opennativeai.onRemoteSessionClosed(handler),
    activateOrSetWorkspace: (path) =>
      window.opennativeai.activateOrSetWorkspace?.(path) ?? Promise.resolve({ activated: false }),
    connectRemote: (remoteOptions, requestId, context) =>
      window.opennativeai.connectRemote(remoteOptions, requestId, context),
    cancelPendingRemoteConnection: (requestId) =>
      window.opennativeai.cancelPendingRemoteConnection?.(requestId) ?? Promise.resolve(),
    bindRemoteWorkspaceSessionContext: (context) =>
      window.opennativeai.bindRemoteWorkspaceSessionContext?.(context) ?? Promise.resolve(),
    disposeRemoteSession: (sessionId) => window.opennativeai.disposeRemoteSession(sessionId),
    isDockerAvailable: () => window.opennativeai.isDockerAvailable(),
    listWSLDistros: () => window.opennativeai.listWSLDistros(),
    listDockerContainers: () => window.opennativeai.listDockerContainers(),
    listSSHConfigAliases: () => window.opennativeai.listSSHConfigAliases(),
    loadMcpFromUserDirectory: (payload) => window.opennativeai.loadMcpFromUserDirectory(payload),
    saveMcpToUserDirectory: (payload) => window.opennativeai.saveMcpToUserDirectory(payload),
    migrateLegacyCommonMcp: (payload) => window.opennativeai.migrateLegacyCommonMcp(payload),
    openExternal: (url) => window.opennativeai.openExternal(url),
    openFeedback: () => window.opennativeai.executeDesktopCommand(DesktopCommandIds.OpenFeedback),
    openCommunity: () => window.opennativeai.executeDesktopCommand(DesktopCommandIds.OpenCommunity),
    canOpenCommunity: (locale) => window.opennativeai.canOpenCommunity(locale),
    openInFileManager: (path) => window.opennativeai.openInFileManager(path),
    openExternalFile: (path) => window.opennativeai.openExternalFile(path),
    openCuaPermissionOnboarding: window.opennativeai.openCuaPermissionOnboarding
      ? (permissionOptions) =>
          window.opennativeai.openCuaPermissionOnboarding?.(permissionOptions) ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    prepareCuaHelperPermissionDrag: window.opennativeai.prepareCuaHelperPermissionDrag
      ? () =>
          window.opennativeai.prepareCuaHelperPermissionDrag?.() ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    startCuaHelperPermissionDrag: window.opennativeai.startCuaHelperPermissionDrag
      ? () => window.opennativeai.startCuaHelperPermissionDrag?.()
      : undefined,
    registerOAuthState: (payload) => window.opennativeai.registerOAuthState(payload),
    onOAuthCallback: (callback) => window.opennativeai.onOAuthCallback(callback),
    onPaymentCallback: (callback) => window.opennativeai.onPaymentCallback(callback),
    onShareImport: (callback) => window.opennativeai.onShareImport?.(callback) ?? (() => {}),
    notifyRendererReady: () => window.opennativeai.notifyRendererReady(),
    reportTelemetryEvent: (payload) => window.opennativeai.reportTelemetryEvent(payload),
    reportArmsCustomEvent: (payload) => {
      recordArmsCustomEventForE2E(payload);
      return window.opennativeai.reportArmsCustomEvent(payload);
    },
    getRendererActionTraceConfig: window.opennativeai.getRendererActionTraceConfig
      ? () => window.opennativeai.getRendererActionTraceConfig!()
      : undefined,
    onRendererActionTraceConfigChanged: window.opennativeai.onRendererActionTraceConfigChanged
      ? (callback) => window.opennativeai.onRendererActionTraceConfigChanged!(callback)
      : undefined,
    reportLocalTtftBatch: (batch) => window.opennativeai.reportLocalTtftBatch(batch),
    reportRendererActionTraceBatch: window.opennativeai.reportRendererActionTraceBatch
      ? (batch) => window.opennativeai.reportRendererActionTraceBatch!(batch)
      : undefined,
    reportRendererHeapSample: window.opennativeai.reportRendererHeapSample
      ? (sample) => window.opennativeai.reportRendererHeapSample!(sample)
      : undefined,
    showTaskNotification: (payload) => window.opennativeai.showTaskNotification(payload),
    syncWindowTabs: (paths) => window.opennativeai.syncWindowTabs(paths),
    syncWindowUnreadCount: (count) => window.opennativeai.syncWindowUnreadCount(count),
    syncActiveTaskSession: (sessionId) => window.opennativeai.syncActiveTaskSession(sessionId),
    syncAppSettings: (patch) => window.opennativeai.syncAppSettings?.(patch),
    setShortcutRecordingActive: (active) =>
      window.opennativeai.setShortcutRecordingActive?.(active),
    onFocusTab: (handler) => window.opennativeai.onFocusTab(handler),
    onNewTab: (handler) => window.opennativeai.onNewTab(handler),
    onCloseActiveContextRequest: (handler) =>
      window.opennativeai.onCloseActiveContextRequest?.(handler) ?? (() => {}),
    onOpenBrowserUrl: (handler) => window.opennativeai.onOpenBrowserUrl?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfacePrepare: (handler) =>
      window.opennativeai.onBrowserViewScreenshotSurfacePrepare?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfaceRelease: (handler) =>
      window.opennativeai.onBrowserViewScreenshotSurfaceRelease?.(handler) ?? (() => {}),
    browserViewScreenshotSurfaceReady: (payload) =>
      window.opennativeai.browserViewScreenshotSurfaceReady?.(payload),
    ...desktopBrowserPlatformBridge,
    onNewTask: (handler) => window.opennativeai.onNewTask(handler),
    onOpenWorkspace: (handler) => {
      // 开发态或升级后的旧窗口可能仍运行未暴露 onOpenWorkspace 的 preload，
      // renderer 直接调用会在启动时崩溃。这里和 activateOrSetWorkspace 一样做兼容兜底，
      // 缺少该 bridge 时只禁用原生菜单回调，不影响应用继续打开。
      return window.opennativeai.onOpenWorkspace?.(handler) ?? (() => {});
    },
    onOpenWorkspacePath: (handler) =>
      window.opennativeai.onOpenWorkspacePath?.(handler) ?? (() => {}),
    onOpenFeedbackDialog: (handler) =>
      window.opennativeai.onOpenFeedbackDialog?.(handler) ?? (() => {}),
    onOpenTicketsPanel: (handler) =>
      window.opennativeai.onOpenTicketsPanel?.(handler) ?? (() => {}),
    onWindowFullscreenChanged: (handler) => window.opennativeai.onWindowFullscreenChanged(handler),
    getDesktopWindowChromeState: window.opennativeai.getDesktopWindowChromeState
      ? () => window.opennativeai.getDesktopWindowChromeState!()
      : undefined,
    onDesktopWindowChromeStateChanged: window.opennativeai.onDesktopWindowChromeStateChanged
      ? (handler) => window.opennativeai.onDesktopWindowChromeStateChanged!(handler)
      : undefined,
    getWindowControlsOverlayMetrics: () =>
      window.opennativeai.getWindowControlsOverlayMetrics?.() ?? null,
    onWindowControlsOverlayChanged: (handler) =>
      window.opennativeai.onWindowControlsOverlayChanged?.(handler) ?? (() => {}),
    getDesktopZoomLevel: () =>
      window.opennativeai.getDesktopZoomLevel?.() ?? Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: (handler) =>
      window.opennativeai.onDesktopZoomLevelChanged?.(handler) ?? (() => {}),
    onTaskNotificationClick: (handler) => window.opennativeai.onTaskNotificationClick(handler),
    exportLogs: () => window.opennativeai.exportLogs(),
    listLogFiles: () => window.opennativeai.listLogFiles?.() ?? Promise.resolve([]),
    readLogFileContent: (
      fileName: string,
      category: "app" | "agent",
      subdir?: string,
      sessionName?: string,
    ) =>
      window.opennativeai.readLogFileContent?.(fileName, category, subdir, sessionName) ??
      Promise.resolve(null),
    revealLogFile: (
      fileName: string,
      category: "app" | "agent",
      subdir?: string,
      sessionName?: string,
    ) =>
      window.opennativeai.revealLogFile?.(fileName, category, subdir, sessionName) ??
      Promise.resolve(false),
    captureWindowScreenshot: () =>
      window.opennativeai.captureWindowScreenshot?.() ?? Promise.resolve(null),
    onUpdateReady: (callback) => window.opennativeai.onUpdateReady(callback),
    onUpdateCheckResult: (callback) => window.opennativeai.onUpdateCheckResult(callback),
    onUpdateStateChanged: (callback) =>
      window.opennativeai.onUpdateStateChanged?.(callback) ?? (() => {}),
    getUpdateState: () =>
      window.opennativeai.getUpdateState?.() ?? Promise.resolve({ kind: "idle", enabled: true }),
    downloadUpdate: () => window.opennativeai.downloadUpdate?.() ?? Promise.resolve(),
    cancelUpdateDownload: () => window.opennativeai.cancelUpdateDownload?.() ?? Promise.resolve(),
    openUpdateStatusWindow: () =>
      window.opennativeai.openUpdateStatusWindow?.() ?? Promise.resolve(),
    getAutoUpdatePreferences: () =>
      window.opennativeai.getAutoUpdatePreferences?.() ??
      Promise.resolve({ autoDownloadAndInstallUpdates: false }),
    setAutoDownloadAndInstallUpdates: (enabled) =>
      window.opennativeai.setAutoDownloadAndInstallUpdates?.(enabled) ?? Promise.resolve(),
    getDesktopSessionActivity: () =>
      window.opennativeai.getDesktopSessionActivity?.() ??
      Promise.resolve({ runningAgentSessionCount: 0 }),
    getOpenNativeAIStdioTapDevState: () =>
      window.opennativeai.getOpenNativeAIStdioTapDevState?.() ??
      Promise.resolve({ enabled: false, visible: false, logDir: "", statePath: "" }),
    onSettingsChanged: (callback) =>
      window.opennativeai.onSettingsChanged?.(callback) ?? (() => {}),
    onApplicationLocaleChanged: (callback) =>
      window.opennativeai.onApplicationLocaleChanged?.(callback) ?? (() => {}),
    onPostUpdateReleaseNotes: (callback) => window.opennativeai.onPostUpdateReleaseNotes(callback),
    acknowledgePostUpdateReleaseNotes: (version) =>
      window.opennativeai.acknowledgePostUpdateReleaseNotes(version),
    skipUpdateVersion: (version) =>
      window.opennativeai.skipUpdateVersion?.(version) ?? Promise.resolve(),
    quitAndInstallUpdate: () => window.opennativeai.quitAndInstallUpdate(),
    getInstalledEditors: () => window.opennativeai.getInstalledEditors(),
    getApplicationIcon: (bundleId) =>
      window.opennativeai.getApplicationIcon?.(bundleId) ?? Promise.resolve(null),
    openInEditor: (editorId, path, editorOptions) =>
      window.opennativeai.openInEditor(editorId, path, editorOptions),
    executeDesktopCommand: (command) => window.opennativeai.executeDesktopCommand(command),
    setApplicationLocale: (locale) => window.opennativeai.setApplicationLocale(locale),
    getSystemLocale: () =>
      window.opennativeai.getSystemLocale?.() ??
      Promise.resolve(navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"),
    setTitleBarTheme: (theme) => window.opennativeai.setTitleBarTheme(theme),
    getDeviceId: () =>
      (window as Window & { __OPENNATIVEAI_DEVICE_ID__?: string }).__OPENNATIVEAI_DEVICE_ID__ ?? "",
  };
}
