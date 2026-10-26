import type { VerifiedRelease } from './release-files.mjs';

export interface ReleaseMetadata { version: string; tag: string; notes: string; checkedAt: string }
export interface UpdateStatus {
  supported: boolean; repository: string; currentVersion: string; phase: string; message: string;
  latest: ReleaseMetadata | null; staged: { version: string; source: string } | null; rollbackAvailable: boolean;
}
export function privateJson(path: string, value: unknown): void;
export class Updates {
  constructor(options: { root: string; dataDir: string; version: string });
  root: string; data: string; version: string; folder: string; work: Promise<UpdateStatus | void> | null;
  read(name: string, fallback?: unknown): unknown;
  write(name: string, value: unknown): void;
  repository(): string;
  status(): UpdateStatus;
  response(url: string, max: number): Promise<Buffer>;
  release(tag?: string): Promise<Record<string, unknown>>;
  check(): Promise<UpdateStatus>;
  locked<T>(task: () => T | Promise<T>): Promise<T>;
  stageLocal(source: string, origin?: string, held?: boolean): Promise<UpdateStatus>;
  stage(tag?: string): Promise<UpdateStatus>;
  prepare(action: string): VerifiedRelease & { source?: string };
  command(action: string, tag?: string): Promise<UpdateStatus>;
}
