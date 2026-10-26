import type { ExecFileOptions } from 'node:child_process';

export interface LinuxServiceStatus {
  supported: boolean; installed: boolean; enabled: boolean; state: string; unit: string;
  pid?: number; exitCode?: number; ready?: boolean;
}
export interface LinuxService {
  unit: string;
  status(): Promise<LinuxServiceStatus>;
  command(action: 'render'): Promise<{ unit: string; path: string; environment: string; text: string }>;
  command(action: 'uninstall'): Promise<{ removed: true; accountDataPreserved: true }>;
  command(action: 'status' | 'inspect' | 'install' | 'start' | 'stop' | 'disable'): Promise<LinuxServiceStatus>;
}
export function linuxService(options: {
  dataDir: string; launcher: string; node?: string; configHome?: string;
  run?: (file: string, args: string[], options: ExecFileOptions) => Promise<{ stdout: string }>;
}): LinuxService;
