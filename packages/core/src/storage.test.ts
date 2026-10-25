import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { atomicWritePrivate, withBrowserProfile } from './storage.js';
describe('state persistence and browser ownership', () => {
  it('atomically replaces a file, preserves the old value on failure, and cleans temporary files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm365-state-'));
    const path = join(dir, 'cache.json');
    atomicWritePrivate(path, 'old'); atomicWritePrivate(path, 'new');
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(() => atomicWritePrivate(dir, 'bad')).toThrow('Cannot persist');
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['cache.json']);
  });
  it('serializes scope logins and releases ownership after an error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'm365-profile-')), profile = join(dir, 'profile');
    let finish!: () => void;
    const gate = new Promise<void>(r => { finish = r; });
    const order: string[] = [];
    const a = withBrowserProfile(profile, async () => { order.push('a'); await gate; });
    const b = withBrowserProfile(profile, async () => { order.push('b'); throw new Error('failure'); });
    const rejection = expect(b).rejects.toThrow('failure');
    await Promise.resolve(); await Promise.resolve(); expect(order).toEqual(['a']);
    finish(); await a; await rejection;
    await withBrowserProfile(profile, async () => { order.push('c'); });
    expect(order).toEqual(['a','b','c']); expect(readdirSync(dir)).toEqual([]);
  });
  it('refuses a profile owned by a live process without removing its lock', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'm365-owned-')), profile = join(dir, 'profile');
    writeFileSync(profile + '.login-lock', String(process.pid));
    await expect(withBrowserProfile(profile, async () => 'wrong')).rejects.toThrow('in use');
    expect(readFileSync(profile + '.login-lock', 'utf8')).toBe(String(process.pid));
  });
});
