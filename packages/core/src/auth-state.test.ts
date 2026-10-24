import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
const scripted = vi.hoisted(() => ({ exp: 1, fail: false }));
vi.mock('@azure/msal-node', () => ({ PublicClientApplication: class {
  getTokenCache() { return { deserialize() {}, serialize: () => '{}', getAllAccounts: async () => [{ username: 'offline' }] }; }
  async acquireTokenSilent() {
    if (scripted.fail) throw new Error('offline');
    return { accessToken: `x.${Buffer.from(JSON.stringify({ exp: scripted.exp, tid: 'offline-tenant', oid: 'offline-user' })).toString('base64url')}.x` };
  }
} }));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
it('keeps readiness fresh through silent renewal, and reports expired auth without opening a browser', async () => {
  vi.stubEnv('M365_DATA_DIR', mkdtempSync(join(tmpdir(), 'm365-auth-state-')));
  vi.stubEnv('M365_CACHE_FILE', ''); vi.stubEnv('M365_SECRETS_FILE', '');
  vi.resetModules();
  const { getToken, authenticationStatus, authenticationAccountKey, refreshAuthenticationSilently } = await import('./auth.js');
  scripted.exp = Math.floor(Date.now()/1000) + 3600;
  await getToken(); expect(authenticationStatus().status).toBe('ready');
  expect(authenticationAccountKey()).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(authenticationStatus())).not.toContain('offline-tenant');
  vi.useFakeTimers(); await vi.advanceTimersByTimeAsync(3_601_000);
  expect(authenticationStatus().status).toBe('auth_required');
  scripted.fail = true;
  expect(await refreshAuthenticationSilently()).toBe(false);
  expect(authenticationStatus().status).toBe('auth_required');
  scripted.fail = false; scripted.exp = Math.floor(Date.now()/1000) + 3600;
  expect(await refreshAuthenticationSilently()).toBe(true);
  expect(authenticationStatus().status).toBe('ready');
});
