export type MemFacts = {
  memTotalMb: number;
  memAvailMb: number;
  swapTotalMb: number;
  swapUsedMb: number;
};
export type Psi = { some: number; full: number };
export const SHORT_AVAIL_FRACTION: number;
export const SHORT_PSI_SOME: number;
export function parseMeminfo(text: string): MemFacts;
export function parsePsi(text: string): Psi;
export function readMeminfo(): MemFacts;
export function readPsi(kind: string): Psi;
export function memoryShort(
  facts: Pick<MemFacts, 'memTotalMb' | 'memAvailMb'>,
  pressure: { some: number },
): boolean;
export function swapStarved(facts: MemFacts, pressure: { some: number }): boolean;
