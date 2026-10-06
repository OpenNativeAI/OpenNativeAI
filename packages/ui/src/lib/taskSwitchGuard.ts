import type { ModelSwitchStage } from "@/store/opennativeaiSessionStoreTypes.js";

export function shouldBlockTaskSelectionDuringModelRestart(
  modelSwitchPending: boolean,
  modelSwitchStage: ModelSwitchStage,
): boolean {
  return modelSwitchPending && modelSwitchStage === "restartingRuntime";
}
