import { getToken, createLogger, startAuthenticationMaintenance } from "@m365-copilot/core";
import { pool } from "../server-pool";
import { validateBind, httpActivity } from "@m365-copilot/proxy-lib";

/**
 * Authenticate against M365 once, at server startup. A failure here throws and
 * aborts boot — the equivalent of the old binary's `process.exit(1)` on auth
 * failure, so the server never comes up half-broken.
 */
export default defineNitroPlugin((app) => {
  process.env.HOST ??= "127.0.0.1";
  process.env.NITRO_HOST ??= process.env.HOST;
  validateBind(process.env.NITRO_HOST);
  httpActivity.sources.alerts.start();
  // Nitro 2 does not await async plugins. Own the rejection and fail the process;
  // readiness remains 503 until getToken has completed successfully.
  void getToken().catch((err: Error) => {
    createLogger("startup").error(`Authentication failed: ${err.message}. Run m365-proxy login, then restart.`);
    pool.close();
    process.exit(78); // configuration/auth recovery needs a human, not rapid retries
  });
  // Keep readiness valid across idle token expiry, without generating chat turns
  // or repeatedly launching a browser when a tenant requires human reapproval.
  const stopMaintenance = startAuthenticationMaintenance();
  app.hooks.hook("close", () => { stopMaintenance(); httpActivity.sources.alerts.close(); pool.close(); httpActivity.sources.flush(); });
  // Late HTTP finish/close events can still arrive while Nitro drains sockets.
  // Keep collecting until the process exits, then synchronously flush and close.
  process.once("exit", () => httpActivity.sources.close());
});
