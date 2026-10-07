export const ROOT: string;
export const BUILD_COMMAND: string;
export type Flavour = 'probe' | 'plain';
export function writeFlavour(root: string, flavour: Flavour): void;
export function isStale(root?: string, opts?: { flavour?: Flavour }): boolean;
export function ensureBuilt(opts?: {
  root?: string;
  build?: (root: string, opts: { flavour?: Flavour }) => Promise<void> | void;
  pollMs?: number;
  flavour?: Flavour;
}): Promise<boolean>;
export function buildExists(root?: string): boolean;
export function prepareBuild(opts?: {
  stale?: (root: string, opts: { flavour: Flavour }) => boolean;
  ensure?: (opts: { root: string; flavour: Flavour }) => Promise<boolean>;
  log?: (message: string) => void;
  root?: string;
}): Promise<boolean>;
