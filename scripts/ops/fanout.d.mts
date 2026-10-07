import type { FanoutGraph, FanoutOptions } from './fanout-graph.mjs';

export function churn(cwd: string, days?: number): Map<string, number>;
export function predict(
  cwd: string,
  g: FanoutGraph,
  specs: string[],
  files: string[],
  deleted: string[],
  opts?: FanoutOptions,
  base?: string,
): { all: boolean; specs: string[]; line: string };
export function branchChanges(
  cwd: string,
  ref: string,
  base?: string,
  at?: string,
): { files: string[]; deleted: string[]; base: string };
export function replay(
  cwd: string,
  g: FanoutGraph,
  specs: string[],
  n: number,
  tests?: string,
  since?: string,
): void;
