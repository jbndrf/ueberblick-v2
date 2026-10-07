/**
 * The device queue as the Einstellungen list shows it (v3 `TaskRunQueueList`) and the run notices at an Objekt
 * (`TaskRunNotices`): one row per run still on the device, with the text of its state and the Objekt it is about.
 * Pure: the runs come from `store.readRuns()` and the sending run from `queue.status()`.
 */
import type { QueueStatus, StoredRun } from '@ueberblick/client';
import type { FeatureId } from '@ueberblick/core/model';
import { isRefusedRunState, type QueueRunState } from '@ueberblick/core/registry';
import { message, type Locale } from '../../messages';
import { runRefusalText } from '../../refusals';

export interface QueueRow {
  readonly runId: string;
  /** The Aufgabe's label. */
  readonly task: string;
  readonly state: Exclude<QueueRunState, 'accepted'>;
  /** The state in words. */
  readonly stateText: string;
  /** Why it was refused or waits for review; absent for a run that is simply waiting. */
  readonly reason: string | undefined;
  /** The Objekt the run is about; absent for a run that creates one (there is nothing on the map to jump to yet). */
  readonly featureId: FeatureId | undefined;
  /** The row's title jumps to the Objekt: only while it is on this device (a refused create took it with it; v3 rows never jumped). */
  readonly canJump: boolean;
  /** Refused because an earlier run was refused (v3 `dependent_rejected`): the text then starts with "Beruht auf einer abgelehnten Änderung.". */
  readonly dependent: boolean;
  /** A refused run can be sent again; the queue sends a waiting run by itself. */
  readonly canResend: boolean;
  /** Any run can be discarded except the one being sent right now (docs/07); v3 asks no confirmation. */
  readonly canDiscard: boolean;
}

export function queueRows(
  runs: readonly StoredRun[],
  status: Pick<QueueStatus, 'sending'>,
  taskLabel: (taskKey: string) => string,
  locale: Locale,
  fieldLabel?: (taskKey: string, fieldKey: string) => string | undefined,
  /** Whether the Objekt is on this device; without it every row with an Objekt may jump. */
  onDevice?: (featureId: FeatureId) => boolean,
): readonly QueueRow[] {
  const rows: QueueRow[] = [];
  const sendingGroup = runs.find((r) => r.run.id === status.sending)?.group; // the whole batch is in flight
  const inFlight = (r: StoredRun): boolean =>
    status.sending === r.run.id || (sendingGroup !== undefined && r.group === sendingGroup);
  for (const r of [...runs].sort((a, b) => a.order - b.order)) {
    if (r.state === 'accepted') continue; // the server has it; it only waits for the next pull
    const state = r.state === 'queued' && inFlight(r) ? 'sending' : r.state;
    rows.push({
      runId: r.run.id,
      task: taskLabel(r.run.task),
      state,
      stateText: message(locale, `run_state_${state}`),
      reason:
        state === 'refused' || state === 'dependent'
          ? runRefusalText(locale, r, (f) => fieldLabel?.(r.run.task, f))
          : state === 'review'
            ? message(locale, 'review_gone', { version: r.run.configVersion })
            : undefined,
      featureId: r.run.featureId,
      canJump: r.run.featureId !== undefined && (onDevice?.(r.run.featureId) ?? true),
      dependent: state === 'dependent',
      canResend: isRefusedRunState(state),
      canDiscard: state !== 'sending',
    });
  }
  return rows;
}

/** Runs the server or the device refused (or that wait for review), optionally only those about one Objekt. */
export const refusedRows = (rows: readonly QueueRow[], featureId?: FeatureId): readonly QueueRow[] =>
  rows.filter(
    (r) =>
      (isRefusedRunState(r.state) || r.state === 'review') &&
      (featureId === undefined || r.featureId === featureId),
  );

/** Runs that still wait to be sent. */
export const openCount = (rows: readonly QueueRow[]): number =>
  rows.filter((r) => r.state === 'queued' || r.state === 'sending').length;
