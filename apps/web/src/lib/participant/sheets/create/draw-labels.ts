// The strings of the drawing controls (v3's `geometry-draw-tool.svelte` labels), from the app's catalogue.
import { GEO_VALIDITY_ISSUES } from '@ueberblick/core/registry';
import type { DrawLabels } from '@ueberblick/ui';
import { message, type Locale, type MessageKey } from '../../messages';

export function drawLabels(locale: Locale): DrawLabels {
  const issues = Object.fromEntries(
    GEO_VALIDITY_ISSUES.keys.map((k) => [k, message(locale, `draw_issue_${k}` as MessageKey)]),
  ) as DrawLabels['issues'];
  return {
    toolbar: message(locale, 'draw_toolbar'),
    cancel: message(locale, 'draw_cancel'),
    newPart: message(locale, 'draw_new_part'),
    part: (n) => message(locale, 'draw_part', { n }),
    undo: message(locale, 'draw_undo'),
    redo: message(locale, 'draw_redo'),
    delete: message(locale, 'draw_delete'),
    finish: message(locale, 'draw_finish'),
    refused: (reason) => message(locale, 'draw_refused', { reason }),
    issues,
  };
}
