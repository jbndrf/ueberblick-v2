/**
 * Keeps the active view with the person (WP-665; v3 `activeViewConfigId`, `+page.svelte:1002-1040`): the id of the
 * view that is on is stored in the preference record (`filters.active`), so it comes back at the next start and on
 * another device, and the map evaluates the view again when the record changes under it (a view edited on another
 * device, the tool switched off or on). A saved view is stored by its id, a role preset as `preset:<key>`.
 */
import type { PrefsClient } from '@ueberblick/client';
import type { TemplateFile } from '@ueberblick/core/model';
import { isToolOn, VIEWS_TOOL } from '../../tools/entries';
import type { ActiveView, FilterController } from './filter-controller';

const PRESET = 'preset:';

export const activeKeyOf = (view: ActiveView | null): string | null =>
  view === null ? null : view.kind === 'preset' ? `${PRESET}${view.key}` : view.key;

/** The view a stored key means, when that view still exists. */
export function viewOfKey(
  key: string | null,
  file: TemplateFile,
  roleKey: string,
  savedIds: readonly string[],
): ActiveView | null {
  if (key === null) return null;
  if (key.startsWith(PRESET)) {
    const preset = key.slice(PRESET.length);
    return file.roles?.[roleKey]?.app?.filter_presets?.[preset] === undefined
      ? null
      : { kind: 'preset', key: preset };
  }
  return savedIds.includes(key) ? { kind: 'saved', key } : null;
}

export type ViewsRecord = Pick<PrefsClient, 'current' | 'set' | 'subscribe' | 'sync'>;

export interface ViewsBinding {
  readonly filter: FilterController;
  readonly record: ViewsRecord;
  readonly file: TemplateFile;
  readonly roleKey: string;
}

/** Restores the stored view, stores every change of it, and refreshes the map when the view's source changes. Returns the stop function. */
export function bindViews({ filter, record, file, roleKey }: ViewsBinding): () => void {
  const saved = () => record.current().filters.saved;
  const restored = viewOfKey(
    record.current().filters.active,
    file,
    roleKey,
    saved().map((s) => s.id),
  );
  if (restored !== null) filter.setActiveView(restored);

  // What the map's pass depends on besides the view's id: the saved sources and the tool's switch.
  const signature = (): string =>
    JSON.stringify([saved(), isToolOn(file, roleKey, record.current().tools, VIEWS_TOOL)]);
  let seen = signature();

  const stopFilter = filter.subscribe(() => {
    const key = activeKeyOf(filter.activeView());
    if (key === record.current().filters.active) return;
    record.set('filters.active', key);
    void record.sync();
  });
  const stopRecord = record.subscribe(() => {
    const now = signature();
    if (now === seen) return;
    seen = now;
    filter.refreshView();
  });
  return () => {
    stopFilter();
    stopRecord();
  };
}
