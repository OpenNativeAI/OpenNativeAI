import {
  collectVisibleOpenNativeAIBackgroundTaskControlItems,
  getOpenNativeAIBackgroundTaskControlItemElapsedMs,
  isActiveOpenNativeAIBackgroundTaskControlItem,
  parseOpenNativeAIBackgroundTaskControlItems,
  type OpenNativeAIBackgroundTaskControlItem,
  type OpenNativeAIBackgroundTaskControlStatus,
} from "./background-task-controls.js";

export type OpenNativeAIBackgroundBashJobStatus = OpenNativeAIBackgroundTaskControlStatus;
export type OpenNativeAIBackgroundBashJob = OpenNativeAIBackgroundTaskControlItem & {
  taskKind: "bash";
};

export function parseOpenNativeAIBackgroundBashJobs(value: unknown): OpenNativeAIBackgroundBashJob[] {
  return parseOpenNativeAIBackgroundTaskControlItems(value).filter(isBackgroundBashJob);
}

export function isActiveOpenNativeAIBackgroundBashJob(job: OpenNativeAIBackgroundBashJob): boolean {
  return isActiveOpenNativeAIBackgroundTaskControlItem(job);
}

export function getOpenNativeAIBackgroundBashJobElapsedMs(
  job: OpenNativeAIBackgroundBashJob,
  now = Date.now(),
): number {
  return getOpenNativeAIBackgroundTaskControlItemElapsedMs(job, now);
}

export function collectVisibleOpenNativeAIBackgroundBashJobs(
  jobs: readonly OpenNativeAIBackgroundBashJob[],
  now = Date.now(),
  thresholdMs = 30_000,
): Array<OpenNativeAIBackgroundBashJob & { elapsedMs: number }> {
  return collectVisibleOpenNativeAIBackgroundTaskControlItems(jobs, now, thresholdMs) as Array<
    OpenNativeAIBackgroundBashJob & { elapsedMs: number }
  >;
}

function isBackgroundBashJob(job: OpenNativeAIBackgroundTaskControlItem): job is OpenNativeAIBackgroundBashJob {
  return job.taskKind === "bash";
}
