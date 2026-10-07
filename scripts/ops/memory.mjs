// The one definition of "memory is short" (R1). logwatch alarms and housekeep's RAM advice both use it.
// Swap alone is noise (idle pages): it counts only while memory is actually short.
import { existsSync, readFileSync } from 'node:fs';

export const SHORT_AVAIL_FRACTION = 0.25; // available below this share of total
export const SHORT_PSI_SOME = 1; // memory PSI some avg60 above this

const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');

/** Pure: /proc/meminfo text to megabytes. */
export function parseMeminfo(text) {
  const mb = (k) => Number(text.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) / 1024;
  return {
    memTotalMb: Math.round(mb('MemTotal')),
    memAvailMb: Math.round(mb('MemAvailable')),
    swapTotalMb: Math.round(mb('SwapTotal')),
    swapUsedMb: Math.round(mb('SwapTotal') - mb('SwapFree')),
  };
}

/** Pure: /proc/pressure/<kind> text to avg60 of "some" and "full". */
export function parsePsi(text) {
  return {
    some: Number(text.match(/some avg10=[\d.]+ avg60=([\d.]+)/)?.[1] ?? 0),
    full: Number(text.match(/full avg10=[\d.]+ avg60=([\d.]+)/)?.[1] ?? 0),
  };
}

export const readMeminfo = () => parseMeminfo(read('/proc/meminfo'));
export const readPsi = (kind) => parsePsi(read(`/proc/pressure/${kind}`));

/** Pure: is memory short? `pressure` is `{ some }` of the memory PSI. */
export function memoryShort({ memTotalMb, memAvailMb }, pressure) {
  return (memTotalMb > 0 && memAvailMb / memTotalMb < SHORT_AVAIL_FRACTION) || pressure.some > SHORT_PSI_SOME;
}

/** Pure: swap is a problem only when it is over half used while memory is short. */
export function swapStarved(facts, pressure) {
  return facts.swapTotalMb > 0 && facts.swapUsedMb / facts.swapTotalMb > 0.5 && memoryShort(facts, pressure);
}
