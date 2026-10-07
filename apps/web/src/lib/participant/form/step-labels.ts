import type { StepLabels } from '@ueberblick/ui';
import { message, type Locale } from '../messages';

/** The strings of the multi-step flow in the person's language (the app's Paraglide catalogue). */
export function stepLabels(locale: Locale): StepLabels {
  const t = (key: Parameters<typeof message>[1], values?: Record<string, string | number>): string =>
    message(locale, key, values);
  return {
    step: (current, total) => t('task_step', { current, total }),
    back: t('task_back'),
    cancel: t('task_cancel'),
    next: t('task_next'),
    submit: t('task_submit'),
    locationUnset: t('task_location_unset'),
    locationSet: t('task_location_set'),
    locationPick: t('task_location_pick'),
    locationUnavailable: t('task_location_unavailable'),
    savedOnline: t('task_saved_online'),
    savedOffline: t('task_saved_offline'),
    saveFailed: t('task_save_failed'),
    accepted: t('task_accepted'),
    refused: (reason) => t('task_refused', { reason }),
    reopen: t('task_reopen'),
    close: t('task_close'),
  };
}
