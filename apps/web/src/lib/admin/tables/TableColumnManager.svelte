<script lang="ts">
  // v3's column manager (`custom-field-manager-generic.svelte`) in a dialog, opened from the "+" of the table's last header:
  // title and description, "Spalte hinzufügen", the list (grip, name, type and "Pflichtfeld" badges, default, edit and delete)
  // or the empty box, and the create, edit and delete dialogs. v3's grip did nothing; here it is the kit's sortable handle
  // (drag the column to its place, or ArrowUp/ArrowDown on the handle; up and down buttons on a phone), because the order
  // is what makes the Hauptspalte (Q15). The whole list goes out through `onsave` (one draft edit); a column that is only
  // in the draft says so until the project is published.
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { arrange, Sortable, type Reorder } from '@ueberblick/ui/components/ui/sortable';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import ConfirmDialog from '../participants/ConfirmDialog.svelte';
  import type { CallResult } from '../participants/types';
  import { emptyForm, formOf, labelTaken, withEdited, without, type ColumnForm } from '../columns/form';
  import { withAdded } from './column-list';
  import { COLUMN_TYPES, isColumnType, type TableColumnDef } from './model';
  import TableColumnForm from './TableColumnForm.svelte';
  import type { ColumnSpec } from './types';

  let {
    open = $bindable(false),
    locale,
    columns,
    onsave,
  }: {
    open?: boolean;
    locale: Locale;
    columns: readonly TableColumnDef[];
    /** Stores the new list (one draft edit); the page reads the draft again after it. */
    onsave: (next: readonly ColumnSpec[]) => Promise<CallResult<null>>;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  const typeLabel = (type: string): string => (isColumnType(type) ? t(`prt_type_${type}` as AdminKey) : type);

  const list = $derived<ColumnSpec[]>(
    columns.map((c) => ({
      key: c.key,
      label: c.label,
      type: c.type,
      ...(c.required ? { required: true } : {}),
      ...(c.default !== undefined ? { default: c.default } : {}),
    })),
  );
  const pending = $derived(new Set(columns.filter((c) => c.pending).map((c) => c.key)));

  let formOpen = $state(false);
  let deleteOpen = $state(false);
  let mode = $state<'create' | 'edit'>('create');
  let current = $state<ColumnSpec | null>(null);
  let form = $state<ColumnForm>(emptyForm('text'));
  let problem = $state<string | null>(null);

  function openCreate(): void {
    mode = 'create';
    current = null;
    form = emptyForm(COLUMN_TYPES[0]);
    problem = null;
    formOpen = true;
  }
  function openEdit(column: ColumnSpec): void {
    mode = 'edit';
    current = column;
    form = formOf(column);
    problem = null;
    formOpen = true;
  }

  async function submit(values: ColumnForm): Promise<void> {
    if (values.label.trim() === '' || values.type === '') {
      problem = t('tbl_col_name_required');
      return;
    }
    if (labelTaken(list, values.label, current?.key)) {
      problem = t('tbl_col_exists');
      return;
    }
    const next = current ? withEdited(list, current.key, values) : withAdded(list, values);
    const result = await onsave(next);
    if (result.ok) formOpen = false;
    else problem = result.message;
  }

  async function remove(): Promise<void> {
    if (!current) return;
    const result = await onsave(without(list, current.key));
    if (result.ok) {
      deleteOpen = false;
      current = null;
    }
  }

  // A reorder is saved at once; until it is, the list is locked, so two quick moves do not both start from the old order.
  let saving = $state(false);
  async function reorder(change: Reorder): Promise<void> {
    if (saving) return;
    saving = true;
    try {
      await onsave(arrange(list, (c) => c.key, change.keys));
    } finally {
      saving = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-2xl sm:max-w-2xl" data-testid="column-manager">
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-3 pr-6">
        <div>
          <Dialog.Title class="text-lg font-semibold">{t('tbl_cols_title')}</Dialog.Title>
          <Dialog.Description class="text-sm text-muted-foreground"
            >{t('tbl_cols_description')}</Dialog.Description
          >
        </div>
        <Button onclick={openCreate} size="sm" data-testid="column-add">
          <Plus class="mr-2 h-4 w-4" />
          {t('tbl_add_column')}
        </Button>
      </div>

      {#if list.length === 0}
        <div class="rounded-lg border border-dashed p-8 text-center">
          <p class="text-sm text-muted-foreground">{t('tbl_cols_none')}</p>
        </div>
      {:else}
        <p class="text-xs text-muted-foreground">{t('tbl_col_order_hint')}</p>
        <Sortable
          items={list}
          key={(c) => c.key}
          onreorder={reorder}
          disabled={saving}
          label={t('tbl_cols_title')}
          handleLabel={(c) => `${t('tbl_col_move')}: ${c.label}`}
          upLabel={(c) => `${t('tbl_col_move_up')}: ${c.label}`}
          downLabel={(c) => `${t('tbl_col_move_down')}: ${c.label}`}
          announce={(c, at, total) => t('tbl_col_moved', { name: c.label, position: at, total })}
          testId={(c) => `column-${c.key}`}
          class="max-h-[50vh] divide-y overflow-y-auto rounded-lg border"
          itemClass="transition-colors hover:bg-muted/50"
        >
          {#snippet row(column, i, grip, moves)}
            <div class="flex items-center gap-3 p-4">
              {@render grip(column)}
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="truncate font-medium">{column.label}</p>
                  {#if i === 0}
                    <span
                      class="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-green-700/10 ring-inset dark:bg-green-950 dark:text-green-300"
                      >{t('tbl_col_main_badge')}</span
                    >
                  {/if}
                  <span
                    title={isColumnType(column.type) ? undefined : t('tbl_col_other_type')}
                    class="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-700/10 ring-inset dark:bg-blue-950 dark:text-blue-300"
                  >
                    {typeLabel(column.type)}
                  </span>
                  {#if column.required}
                    <span
                      class="inline-flex items-center rounded-md bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-700 ring-1 ring-yellow-700/10 ring-inset dark:bg-yellow-950 dark:text-yellow-300"
                      >{t('tbl_col_required')}</span
                    >
                  {/if}
                  {#if pending.has(column.key)}
                    <span class="text-xs text-muted-foreground italic">{t('tbl_col_pending')}</span>
                  {/if}
                </div>
                {#if column.default !== undefined}
                  <p class="mt-1 text-xs text-muted-foreground">
                    {t('tbl_col_default_prefix', { value: String(column.default) })}
                  </p>
                {/if}
              </div>
              <div class="flex gap-1">
                {@render moves(column, i)}
                {#if isColumnType(column.type)}
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8"
                    aria-label="{t('tbl_col_edit')}: {column.label}"
                    onclick={() => openEdit(column)}
                  >
                    <Pencil class="h-4 w-4" />
                  </Button>
                {/if}
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 text-destructive hover:text-destructive"
                  aria-label="{t('tbl_col_delete')}: {column.label}"
                  onclick={() => {
                    current = column;
                    deleteOpen = true;
                  }}
                >
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>
            </div>
          {/snippet}
        </Sortable>
      {/if}
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>{t('tbl_close')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<TableColumnForm
  bind:open={formOpen}
  {locale}
  {mode}
  {form}
  types={COLUMN_TYPES}
  {problem}
  onsubmit={submit}
/>
<ConfirmDialog
  bind:open={deleteOpen}
  title={t('tbl_col_delete_title', { name: current?.label ?? '' })}
  description={t('tbl_col_delete_confirm', { name: current?.label ?? '' })}
  confirmLabel={t('tbl_col_delete')}
  cancelLabel={t('tbl_cancel')}
  onconfirm={remove}
/>
