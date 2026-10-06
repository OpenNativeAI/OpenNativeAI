import { useCallback, useEffect, useState } from "react";
import { FolderSearch } from "lucide-react";
import type { LocalEngineStatus } from "@opennativeai/shared";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { EngineInfoCard } from "@/settings/LocalEngineInfoCard.js";
import { logger } from "@/logger.js";

// 与 validationAppSettings.ts 中引擎字段的边界保持一致，避免 UI 放行却被 schema 拒绝。
const CONTEXT_MIN = 1;
const CONTEXT_MAX = 1_048_576;
const THREADS_MIN = 1;
const THREADS_MAX = 64;
const TEMPERATURE_MIN = 0;
const TEMPERATURE_MAX = 2;

/** 解析并校验数值输入；空值、NaN 或越界时返回 null，交由调用方回退草稿并提示。 */
function parseNumber(raw: string, min: number, max: number, integer: boolean): number | null {
  if (raw.trim() === "") {
    return null;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return integer ? Math.round(parsed) : parsed;
}

/**
 * 本地文本引擎设置面板。
 * 除将核心推理参数（模型路径、上下文长度、线程数、GPU 加速、温度）持久化到 AppSettings 外，
 * “启动引擎”开关会调用 Host 的 ILocalEngineService：加载 GGUF、起本地服务并把模型注册进 provider registry。
 */
export function TextEngineSection() {
  const { intl } = useOpenNativeAIIntl();
  const platform = usePlatform();
  const { settings, update } = useSettings();
  // 引擎生命周期服务只在桌面本地 Host 提供；远端/测试环境拿到时降级为仅保存配置。
  const localEngineService = useServices().localEngineService;

  // 引擎总开关：未启动时下方参数置灰不生效，使“启动”控件有明确语义。
  const enabled = settings?.localEngineEnabled ?? false;
  const [status, setStatus] = useState<LocalEngineStatus | null>(null);
  const [busy, setBusy] = useState(false);

  // 数值字段以字符串草稿态保存，允许用户中途清空；失焦且合法时才提交。
  const [modelPathDraft, setModelPathDraft] = useState("");
  const [contextDraft, setContextDraft] = useState("");
  const [threadsDraft, setThreadsDraft] = useState("");
  const [temperatureDraft, setTemperatureDraft] = useState("");

  // 以持久化设置为准回填草稿，保证外部变更（跨窗口同步等）能反映到面板。
  useEffect(() => {
    setModelPathDraft(settings?.localEngineModelPath ?? "");
    setContextDraft(String(settings?.localEngineContextLength ?? CONTEXT_MIN));
    setThreadsDraft(String(settings?.localEngineThreads ?? 4));
    setTemperatureDraft(String(settings?.localEngineTemperature ?? 0.7));
  }, [
    settings?.localEngineModelPath,
    settings?.localEngineContextLength,
    settings?.localEngineThreads,
    settings?.localEngineTemperature,
  ]);

  // 面板挂载时拉取引擎当前状态，保证跨窗口/重启后面板与 Host 实际运行状态一致。
  useEffect(() => {
    if (!localEngineService) {
      return;
    }
    let active = true;
    void localEngineService
      .getStatus()
      .then((next) => {
        if (active) {
          setStatus(next);
        }
      })
      .catch(() => {
        // 状态拉取失败不阻断面板，仅保留默认文案。
      });
    return () => {
      active = false;
    };
  }, [localEngineService]);

  // 引擎运行中按固定间隔（约 2s）动态刷新运行时/内存详情，体现推理过程中的实时变化；
  // 仅依赖 running 布尔，避免每次 info 更新重建定时器；面板卸载或引擎停止即清理，不后台常驻。
  const running = status?.running ?? false;
  useEffect(() => {
    if (!localEngineService || !running) {
      return;
    }
    const timer = setInterval(() => {
      void localEngineService
        .getStatus()
        .then(setStatus)
        .catch(() => {
          // 刷新失败保留上一次状态，不打断展示。
        });
    }, 2000);
    return () => {
      clearInterval(timer);
    };
  }, [localEngineService, running]);

  const commitContext = useCallback(async () => {
    const value = parseNumber(contextDraft, CONTEXT_MIN, CONTEXT_MAX, true);
    if (value === null) {
      toast(intl.formatMessage({ id: "settings.textEngine.invalidNumber" }));
      setContextDraft(String(settings?.localEngineContextLength ?? ""));
      return;
    }
    if (value === settings?.localEngineContextLength) {
      return;
    }
    try {
      await update({ localEngineContextLength: value });
    } catch (error) {
      logger.warn("[settings.textEngine] 保存上下文长度失败", { error });
    }
  }, [contextDraft, intl, settings?.localEngineContextLength, update]);

  const commitThreads = useCallback(async () => {
    const value = parseNumber(threadsDraft, THREADS_MIN, THREADS_MAX, true);
    if (value === null) {
      toast(intl.formatMessage({ id: "settings.textEngine.invalidNumber" }));
      setThreadsDraft(String(settings?.localEngineThreads ?? ""));
      return;
    }
    if (value === settings?.localEngineThreads) {
      return;
    }
    try {
      await update({ localEngineThreads: value });
    } catch (error) {
      logger.warn("[settings.textEngine] 保存线程数失败", { error });
    }
  }, [intl, settings?.localEngineThreads, threadsDraft, update]);

  const commitTemperature = useCallback(async () => {
    const value = parseNumber(temperatureDraft, TEMPERATURE_MIN, TEMPERATURE_MAX, false);
    if (value === null) {
      toast(intl.formatMessage({ id: "settings.textEngine.invalidNumber" }));
      setTemperatureDraft(String(settings?.localEngineTemperature ?? ""));
      return;
    }
    if (value === settings?.localEngineTemperature) {
      return;
    }
    try {
      await update({ localEngineTemperature: value });
    } catch (error) {
      logger.warn("[settings.textEngine] 保存温度失败", { error });
    }
  }, [intl, settings?.localEngineTemperature, temperatureDraft, update]);

  const handleBrowseModel = useCallback(async () => {
    const selected = await platform.selectFile();
    if (!selected) {
      return;
    }
    setModelPathDraft(selected);
    try {
      await update({ localEngineModelPath: selected });
    } catch (error) {
      logger.warn("[settings.textEngine] 保存模型路径失败", { error });
    }
  }, [platform, update]);

  const handleModelPathBlur = useCallback(async () => {
    const trimmed = modelPathDraft.trim();
    if (trimmed === (settings?.localEngineModelPath ?? "")) {
      return;
    }
    try {
      await update({ localEngineModelPath: trimmed });
    } catch (error) {
      logger.warn("[settings.textEngine] 保存模型路径失败", { error });
    }
  }, [modelPathDraft, settings?.localEngineModelPath, update]);

  const handleGpuChange = useCallback(
    async (checked: boolean) => {
      try {
        await update({ localEngineGpuEnabled: checked });
      } catch (error) {
        logger.warn("[settings.textEngine] 保存 GPU 开关失败", { error });
      }
    },
    [update],
  );

  // 常驻内存（mlock）为加载参数，与 GPU/线程一致仅写入设置，下次启动引擎时生效。
  const handleKeepInMemoryChange = useCallback(
    async (checked: boolean) => {
      try {
        await update({ localEngineKeepInMemory: checked });
      } catch (error) {
        logger.warn("[settings.textEngine] 保存常驻内存开关失败", { error });
      }
    },
    [update],
  );

  const handleEnabledChange = useCallback(
    async (checked: boolean) => {
      setBusy(true);
      try {
        if (localEngineService) {
          const next = checked ? await localEngineService.start() : await localEngineService.stop();
          setStatus(next);
          // 启动未进入 running（缺模型/非 macOS/注册失败）时不回写开关，避免 UI 显示已开启但实际未跑。
          if (checked && !next.running) {
            toast(next.error ?? intl.formatMessage({ id: "settings.textEngine.startFailed" }));
            return;
          }
        }
        await update({ localEngineEnabled: checked });
      } catch (error) {
        logger.warn("[settings.textEngine] 切换本地引擎失败", { error });
        toast(intl.formatMessage({ id: "settings.textEngine.startFailed" }));
      } finally {
        setBusy(false);
      }
    },
    [intl, localEngineService, update],
  );

  // 开关行描述随引擎状态变化，让用户看到“启动中/已运行/错误/不支持”等真实反馈。
  const enabledDescription = !localEngineService
    ? intl.formatMessage({ id: "settings.textEngine.unavailable" })
    : status?.state === "starting"
      ? intl.formatMessage({ id: "settings.textEngine.starting" })
      : status?.state === "running"
        ? intl.formatMessage({ id: "settings.textEngine.running" })
        : status?.state === "unsupported"
          ? intl.formatMessage({ id: "settings.textEngine.unsupported" })
          : status?.state === "error"
            ? (status.error ?? intl.formatMessage({ id: "settings.textEngine.startFailed" }))
            : intl.formatMessage({ id: "settings.textEngine.enabled.description" });

  return (
    <div className="space-y-6">
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.textEngine.enabled" })}
          description={enabledDescription}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "settings.textEngine.enabled" })}
              checked={enabled}
              disabled={busy}
              onCheckedChange={(checked) => void handleEnabledChange(checked)}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.textEngine.modelPath" })}
          description={intl.formatMessage({ id: "settings.textEngine.modelPath.description" })}
          control={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!enabled}
              onClick={() => void handleBrowseModel()}
            >
              <FolderSearch className="size-3.5" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.textEngine.modelPath.browse" })}
            </Button>
          }
          detail={
            <Input
              value={modelPathDraft}
              onChange={(event) => setModelPathDraft(event.target.value)}
              onBlur={() => void handleModelPathBlur()}
              placeholder="model.gguf"
              spellCheck={false}
              disabled={!enabled}
              aria-label={intl.formatMessage({ id: "settings.textEngine.modelPath" })}
              className="font-mono"
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.textEngine.contextLength" })}
          description={intl.formatMessage({ id: "settings.textEngine.contextLength.description" })}
          control={
            <Input
              type="number"
              inputMode="numeric"
              min={CONTEXT_MIN}
              max={CONTEXT_MAX}
              step={1}
              value={contextDraft}
              onChange={(event) => setContextDraft(event.target.value)}
              onBlur={() => void commitContext()}
              disabled={!enabled}
              aria-label={intl.formatMessage({ id: "settings.textEngine.contextLength" })}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.textEngine.threads" })}
          description={intl.formatMessage({ id: "settings.textEngine.threads.description" })}
          control={
            <Input
              type="number"
              inputMode="numeric"
              min={THREADS_MIN}
              max={THREADS_MAX}
              step={1}
              value={threadsDraft}
              onChange={(event) => setThreadsDraft(event.target.value)}
              onBlur={() => void commitThreads()}
              disabled={!enabled}
              aria-label={intl.formatMessage({ id: "settings.textEngine.threads" })}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.textEngine.temperature" })}
          description={intl.formatMessage({ id: "settings.textEngine.temperature.description" })}
          control={
            <Input
              type="number"
              inputMode="decimal"
              min={TEMPERATURE_MIN}
              max={TEMPERATURE_MAX}
              step={0.1}
              value={temperatureDraft}
              onChange={(event) => setTemperatureDraft(event.target.value)}
              onBlur={() => void commitTemperature()}
              disabled={!enabled}
              aria-label={intl.formatMessage({ id: "settings.textEngine.temperature" })}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.textEngine.gpuEnabled" })}
          description={intl.formatMessage({ id: "settings.textEngine.gpuEnabled.description" })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "settings.textEngine.gpuEnabled" })}
              checked={settings?.localEngineGpuEnabled ?? true}
              disabled={!enabled}
              onCheckedChange={(checked) => void handleGpuChange(checked)}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.textEngine.keepInMemory" })}
          description={intl.formatMessage({ id: "settings.textEngine.keepInMemory.description" })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "settings.textEngine.keepInMemory" })}
              checked={settings?.localEngineKeepInMemory ?? false}
              disabled={!enabled}
              onCheckedChange={(checked) => void handleKeepInMemoryChange(checked)}
            />
          }
        />
      </SettingsGroupCard>
      {status?.info ? <EngineInfoCard info={status.info} baseUrl={status.baseUrl} /> : null}
    </div>
  );
}
