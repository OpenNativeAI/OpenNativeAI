import { net } from "electron";
import {
  buildHelpAppConfigUrl,
  buildOpenNativeAISourceHeadersFromContext,
  createHelpAppConfigReader,
  OPENNATIVEAI_ENV,
} from "@opennativeai/shared";

export function createDesktopHelpConfigReader(options: {
  resolveEndpointOrigin: () => Promise<string>;
  appVersion: string;
  deviceMid: string;
}) {
  const read = createHelpAppConfigReader({ fetchImpl: (input, init) => net.fetch(input, init) });
  return async () => {
    const endpointOrigin = await options.resolveEndpointOrigin();
    return read(
      buildHelpAppConfigUrl(
        endpointOrigin,
        options.appVersion,
        `${process.platform}-${process.arch}`,
      ),
      buildOpenNativeAISourceHeadersFromContext({
        endpointOrigin,
        appVersion: options.appVersion,
        deviceMid: options.deviceMid,
        platform: process.platform,
        arch: process.arch,
        releaseChannel: OPENNATIVEAI_ENV,
        sourceTitle: "electron",
      }),
    );
  };
}
