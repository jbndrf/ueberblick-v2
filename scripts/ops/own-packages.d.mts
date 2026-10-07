export type OwnPackagesOffender = { name: string; resolved: string | null };
export type OwnPackagesResult = { ok: boolean; relinked: boolean; message: string | null };
export function checkOwnPackages(root: string): OwnPackagesOffender[];
export function ensureOwnPackages(root: string, opts?: { link?: (root: string) => void }): OwnPackagesResult;
export function requireOwnPackages(root?: string): OwnPackagesResult;
