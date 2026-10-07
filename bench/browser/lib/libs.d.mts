export const LIBS_DIR: string;
export const LIB_PATH: string;
export function missingLibs(lddOutput: string): string[];
export function debPackagesFor(sonames: readonly string[]): string[];
export function ensureLibs(exe: string): Record<string, string>;
