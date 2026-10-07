export interface FanoutOptions {
  barrels?: 'none' | 'ui-root' | 'all';
  eraseTypes?: boolean;
  additiveBarrels?: boolean;
}
export interface FanoutGraph {
  nodes: Map<string, unknown>;
  uiRoot: string;
}
export function codeFiles(cwd: string): string[];
export function parseModule(text: string): unknown;
export function buildGraph(cwd: string, files: string[], read?: (file: string) => string): FanoutGraph;
export function buildGraphAt(cwd: string, rev: string): { g: FanoutGraph; files: string[] };
export function specsFor(g: FanoutGraph, specs: string[], changed: string[], opts?: FanoutOptions): string[];
export function fanoutPerFile(g: FanoutGraph, specs: string[], opts?: FanoutOptions): Map<string, number>;
