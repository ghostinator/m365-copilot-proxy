import type { BinaryLike } from 'node:crypto';

export interface VerifiedRelease { version: string; manifestHash: string; directory: string; node: string }
export function sha(value: BinaryLike): string;
export const versionPattern: RegExp;
export function releasePath(root: string, name: string): string;
export function verifyRelease(root: string, platform?: NodeJS.Platform, architecture?: string): VerifiedRelease;
