import type { Dirent, Stats } from 'node:fs';

export const fsx: {
  lstat: (path: string) => Stats;
  readdir: (path: string, opts?: { withFileTypes: true }) => string[] | Dirent[];
};
export function vanished(e: unknown): boolean;
export function ifPresent<T>(read: () => T): T | undefined;
export function statOf(path: string): Stats | undefined;
export function listOf(path: string, opts?: { withFileTypes: true }): string[] | Dirent[] | undefined;
