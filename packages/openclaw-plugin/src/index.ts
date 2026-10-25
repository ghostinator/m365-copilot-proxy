import { getToken, getAvailableModels, createLogger, startAuthenticationMaintenance } from "@m365-copilot/core";
import { createApp } from "@m365-copilot/proxy-lib";
export { mergeOpenClawConfig, updateOpenClawConfig } from "./config.js";
import { serve } from "srvx";

const log = createLogger("openclaw-plugin");

export { getAvailableModels };

export { generateOpenClawConfig, type OpenClawConfig, type OpenClawModelConfig, type OpenClawProviderConfig } from "@m365-copilot/proxy-lib";
import { generateOpenClawConfig, type OpenClawConfig } from "@m365-copilot/proxy-lib";

export interface ProxyHandle {
  port: number;
  close: () => Promise<void>;
}

/**
 * Start the M365 proxy and return the OpenClaw config pointing to it.
 */
export async function startForOpenClaw(options: { port?: number } = {}): Promise<{
  proxy: ProxyHandle;
  config: OpenClawConfig;
}> {
  log.info("Starting M365 proxy for OpenClaw...");

  try {
    await getToken();
  } catch (err: any) {
    log.error("Auth failed:", err.message);
    throw err;
  }

  const app = createApp();
  const port = options.port ?? 4141;

  // Bind and resolve the *actual* port (port 0 picks a free one).
  const server = serve({ fetch: app.fetch, port, hostname: "localhost", silent: true });
  await server.ready();
  const stopMaintenance = startAuthenticationMaintenance();
  const actualPort = server.url ? Number(new URL(server.url).port || port) : port;

  const config = generateOpenClawConfig(actualPort);
  log.info(`Proxy started on port ${actualPort}`);

  return {
    proxy: {
      port: actualPort,
      close: async () => {
        stopMaintenance();
        app.close();
        await server.close();
      },
    },
    config,
  };
}
