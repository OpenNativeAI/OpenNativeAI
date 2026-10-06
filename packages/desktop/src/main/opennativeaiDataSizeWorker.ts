import { isMainThread, parentPort, workerData } from "node:worker_threads";

import { scanOpenNativeAIDataDirectory, type OpenNativeAIDataSizeScanRequest } from "./opennativeaiDataSizeScanner.js";

type WorkerResponse =
  | { ok: true; result: Awaited<ReturnType<typeof scanOpenNativeAIDataDirectory>> }
  | { ok: false; error: string };

const workerParentPort = parentPort;
if (!isMainThread && workerParentPort) {
  void scanOpenNativeAIDataDirectory(workerData as OpenNativeAIDataSizeScanRequest)
    .then((result) => {
      workerParentPort.postMessage({ ok: true, result } satisfies WorkerResponse);
    })
    .catch((error) => {
      workerParentPort.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : "unknown worker error",
      } satisfies WorkerResponse);
    });
}
