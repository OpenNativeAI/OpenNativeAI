import type { OpenNativeAIBackgroundTaskControlItem } from "./background-task-controls.js";

export function mergeOpenNativeAIBackgroundTaskControlItems(
  current: readonly OpenNativeAIBackgroundTaskControlItem[],
  updates: readonly OpenNativeAIBackgroundTaskControlItem[],
): OpenNativeAIBackgroundTaskControlItem[] {
  const jobsById = new Map(current.map((job) => [job.jobId, job] as const));
  for (const job of updates) {
    jobsById.set(job.jobId, job);
  }
  return Array.from(jobsById.values());
}
