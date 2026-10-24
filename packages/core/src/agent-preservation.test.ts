import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./auth.js', () => ({ getTokenForScope: async () => 'offline-token' }));
vi.mock('node:crypto', async (actual) => ({ ...await actual<typeof import('node:crypto')>(), createHash: () => ({ update() { return this; }, digest: () => 'deadbeef' }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('preserves a discovered shared bot when publish fails', async () => {
  vi.stubEnv('M365_DATA_DIR', mkdtempSync(join(tmpdir(), 'm365-bot-'))); vi.resetModules();
  const methods: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    methods.push(init.method ?? 'GET');
    if (url.includes('~default')) return Response.json({ name: 'Default-00000000-0000-0000-0000-000000000001' });
    if (init.method === 'HEAD') return new Response(null, { status: 200 });
    if (url.includes('/publish?')) return new Response('transient', { status: 503 });
    return Response.json([{ botId: 'shared-bot', shortBotName: 'm365-tool-agent-deadbeef' }]);
  }));
  const { getOrCreateAgent } = await import('./agent.js');
  expect(await getOrCreateAgent({ forceRefresh: true })).toBeNull();
  expect(methods).not.toContain('DELETE');
  expect(methods.filter(m => m === 'POST')).toHaveLength(1);
});
