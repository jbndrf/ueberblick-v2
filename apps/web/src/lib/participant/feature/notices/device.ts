/** What the run notices read and call on the device: the queue's own list, status and the two actions (WP-627). */
import type { Device } from '../../device';

export interface NoticesDevice {
  readonly queue: Pick<Device['queue'], 'status' | 'subscribe' | 'discard' | 'resubmit'>;
  readonly store: Pick<Device['store'], 'readRuns'>;
}
