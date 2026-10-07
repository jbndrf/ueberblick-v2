export function workspaceNames(root?: string): Set<string>;
export function externalRuntimeDeps(root?: string, webPackageJson?: string): Record<string, string>;
export function pinnedRuntimeDeps(root?: string): Record<string, string>;
export function missingRuntimeDeps(dockerfile: string, deps: Record<string, string>): string[];
