// What the download card above the bar shows (v3 `map/+page.svelte:2791`): the pack that downloads now, how far it is,
// and how many wait behind it. Nothing while no download runs.
import type { PackProgress } from '@ueberblick/client';

export interface DownloadingNow {
  readonly key: string;
  readonly label: string;
  readonly done: number;
  readonly total: number;
  readonly queued: number;
}

export function downloadingNow(
  progress: Readonly<Record<string, PackProgress>>,
  labelOf: (key: string) => string,
): DownloadingNow | undefined {
  const entries = Object.entries(progress);
  const running = entries.find(([, p]) => p.state === 'downloading');
  const queued = entries.filter(([, p]) => p.state === 'queued').length;
  if (running === undefined) return undefined;
  const [key, p] = running;
  return { key, label: labelOf(key), done: p.bytes_done, total: p.bytes_total, queued };
}
