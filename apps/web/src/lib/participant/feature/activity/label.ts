/**
 * What a run did, in one line (v3 `toolUsageLabel`, reference/src/lib/utils/tool-usage-label.ts:53): the one place the
 * Aktivität tab and the Zuletzt row turn an `ActivityLabel` into words (R1), and the newest entry of a timeline.
 * v3's "Daten erfasst", "Inspektion erfasst", "Admin hat aktualisiert" and "Synchronisierungskonflikt gelöst" named
 * v3 tool kinds; a v4 run is a task, so a run with no changed value shows its task's label.
 */
import type { Instant } from '@ueberblick/core/model';
import type { ActivityLabel, ActivityView } from '@ueberblick/ui';
import { message, type Locale } from '../../messages';

export function activityLabelText(label: ActivityLabel, task: string, locale: Locale): string {
  switch (label.kind) {
    case 'created':
      return message(locale, 'activity_created');
    case 'location':
      return message(locale, 'activity_location_updated');
    case 'field':
      return message(locale, 'activity_field_updated', { label: label.label });
    case 'fields':
      return message(locale, 'activity_fields_updated', { count: label.count });
    default:
      return task;
  }
}

export interface LatestActivity {
  /** The newest entry's line; absent when the timeline has no entry. */
  readonly text?: string;
  /** The current stage's label (the newest stage visit); absent for a type without a process. */
  readonly stage?: string;
}

/** The newest entry of a timeline (a run, a stage move or the creation) and the current stage. O(1): only the newest visit is read. */
export function latestActivity(view: ActivityView, locale: Locale): LatestActivity {
  const s = view.segments[0];
  if (s === undefined) return {};
  const stage = s.stageLabel === undefined ? {} : { stage: s.stageLabel };
  const candidates: { at: Instant; text: string }[] = [];
  const run = s.entries[0];
  if (run !== undefined)
    candidates.push({ at: run.at, text: activityLabelText(run.label, run.task, locale) });
  if (s.transition !== undefined)
    candidates.push({
      at: s.transition.at,
      text: message(locale, 'recent_stage_change', { stage: s.stageLabel ?? '' }),
    });
  if (s.creation !== undefined)
    candidates.push({ at: s.creation.at, text: message(locale, 'activity_created') });
  const newest = candidates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  return newest === undefined ? stage : { text: newest.text, ...stage };
}
