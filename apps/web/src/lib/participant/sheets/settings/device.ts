/**
 * What the Einstellungen sheet reads and calls on the device: the narrow slice of `Device`, so the sheet runs under
 * test with small fakes and never reaches for more than the queue, the sync worker and the clock (R1: it decides nothing).
 */
import type { FeatureId } from '@ueberblick/core/model';
import type { Device } from '../../device';

export interface SettingsDevice {
  readonly participant: Device['participant'];
  /** The cached identity: own login (info-page variables), info pages and legal pages. */
  readonly identity: Pick<Device['identity'], 'login' | 'infoPages' | 'legalPages'>;
  readonly clock: Device['clock'];
  readonly queue: Pick<Device['queue'], 'status' | 'subscribe' | 'discard' | 'resubmit'>;
  /** The Objekte on the device changed (a refused create leaves it): rows that may jump to one follow. */
  readonly changed: Pick<Device['changed'], 'subscribe'>;
  readonly store: Pick<Device['store'], 'readRuns'> & {
    /** Whether an Objekt is on the device decides if a queue row may jump to it. */
    readonly facts: { feature(id: FeatureId): object | undefined };
  };
  /** The problem log: a fault of the sync host is shown where v3 shows a failed sync (WP-656). */
  readonly problems: Pick<Device['problems'], 'list' | 'subscribe'>;
  readonly sync: {
    syncNow(): Promise<void>;
    readonly worker: Pick<Device['sync']['worker'], 'status' | 'subscribe'>;
  };
}
