import { useOpenNativeAIStoreWithDefault } from "@/store/StoreProvider.js";

export function useIsOfficeMode(): boolean {
  return useOpenNativeAIStoreWithDefault((state) => state.interfaceMode === "office", false);
}
