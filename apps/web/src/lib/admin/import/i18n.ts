import type { AdminKey } from '../../../routes/(admin)/admin/shell/messages';

/** The admin message lookup the wizard's steps receive (already bound to the locale). */
export type T = (key: AdminKey, values?: Record<string, string | number>) => string;

/** v3's select (`csv-import-dialog.svelte`): native, so phones show their own picker. */
export const SELECT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
