<script lang="ts">
  // v3's custom-field manager (`custom-field-manager-generic.svelte`), opened from the "+" in the table's last header:
  // title and description, "Feld hinzufügen", the list (grip, name, type and "Pflichtfeld" badges, default, edit and
  // delete) or the empty box, and the create, edit and delete dialogs. It writes the whole list through `onsave`. v3's grip
  // did nothing; here it is the kit's sortable handle (drag, or ArrowUp/ArrowDown on it; up and down buttons on a phone),
  // because the list order is the column order of the roster.
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { arrange, Sortable, type Reorder } from '@ueberblick/ui/components/ui/sortable';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { emptyForm, formOf, labelTaken, withEdited, without, type ColumnForm } from '../columns/form';
  import { withAdded } from './columns';
  import ColumnFormDialog from './ColumnFormDialog.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import type { CallResult, CustomColumn } from './types';

  let {
    open = $bindable(false),
    locale,
    columns,
    types,
    onsave,
  }: {
    open?: boolean;
    locale: Locale;
    columns: readonly CustomColumn[];
    types: readonly string[];
    /** Stores the new list; the page reloads the roster after it. */
    onsave: (next: readonly CustomColumn[]) => Promise<CallResult<null>>;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  const typeLabel = (type: string): string => t(`prt_type_${type}` as AdminKey);

  let formOpen = $state(false);
  let deleteOpen = $state(false);
  let mode = $state<'create' | 'edit'>('create');
  let current = $state<CustomColumn | null>(null);
  let form = $state<ColumnForm>(emptyForm('text'));
  let problem = $state<string | null>(null);

  const firstType = (): string => types[0] ?? 'text';

  function openCreate(): void {
    mode = 'create';
    current = null;
    form = emptyForm(firstType());
    problem = null;
    formOpen = true;
  }
  function openEdit(column: CustomColumn): void {
    mode = 'edit';
    current = column;
    form = formOf(column);
    problem = null;
    formOpen = true;
  }

  async function submit(values: ColumnForm): Promise<void> {
    if (values.label.trim() === '' || values.type === '') {
      problem = t('prt_fields_name_required');
      return;
    }
    if (labelTaken(columns, values.label, current?.key)) {
      problem = t('prt_fields_exists');
      return;
    }
    const next = current ? withEdited(columns, current.key, values) : withAdded(columns, values);
    const result = await onsave(next);
    if (result.ok) formOpen = false;
    else problem = result.message;
  }

  async function remove(): Promise<void> {
    if (!current) return;
    const result = await onsave(without(columns, current.key));
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
      await onsave(arrange(columns, (c) => c.key, change.keys));
    } finally {
      saving = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-2xl sm:max-w-2xl">
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-3 pr-6">
        <div>
          <Dialog.Title class="text-lg font-semibold">{t('prt_fields_title')}</Dialog.Title>
          <Dialog.Description class="text-sm text-muted-foreground"
            >{t('prt_fields_description')}</Dialog.Description
          >
        </div>
        <Button onclick={openCreate} size="sm">
          <Plus class="mr-2 h-4 w-4" />
          {t('prt_fields_add')}
        </Button>
      </div>

      {#if columns.length === 0}
        <div class="rounded-lg border border-dashed p-8 text-center">
          <p class="text-sm text-muted-foreground">{t('prt_fields_none')}</p>
        </div>
      {:else}
        <Sortable
          items={columns}
          key={(c) => c.key}
          onreorder={reorder}
          disabled={saving}
          label={t('prt_fields_title')}
          handleLabel={(c) => `${t('prt_fields_move')}: ${c.label}`}
          upLabel={(c) => `${t('prt_fields_move_up')}: ${c.label}`}
          downLabel={(c) => `${t('prt_fields_move_down')}: ${c.label}`}
          announce={(c, at, total) => t('prt_fields_moved', { name: c.label, position: at, total })}
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
                  <span
                    class="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-700/10 ring-inset dark:bg-blue-950 dark:text-blue-300"
                  >
                    {typeLabel(column.type)}
                  </span>
                  {#if column.required}
                    <span
                      class="inline-flex items-center rounded-md bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-700 ring-1 ring-yellow-700/10 ring-inset dark:bg-yellow-950 dark:text-yellow-300"
                    >
                      {t('prt_fields_required')}
                    </span>
                  {/if}
                </div>
                {#if column.default !== undefined}
                  <p class="mt-1 text-xs text-muted-foreground">
                    {t('prt_fields_default_prefix', { value: String(column.default) })}
                  </p>
                {/if}
              </div>
              <div class="flex gap-1">
                {@render moves(column, i)}
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  aria-label="{t('prt_fields_edit')}: {column.label}"
                  onclick={() => openEdit(column)}
                >
                  <Pencil class="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 text-destructive hover:text-destructive"
                  aria-label="{t('prt_fields_remove')}: {column.label}"
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
      <Button variant="outline" onclick={() => (open = false)}>{t('prt_close')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<ColumnFormDialog bind:open={formOpen} {locale} {mode} {form} {types} {problem} onsubmit={submit} />
<ConfirmDialog
  bind:open={deleteOpen}
  title={t('prt_fields_delete_title', { name: current?.label ?? '' })}
  description={t('prt_fields_delete_confirm')}
  confirmLabel={t('prt_delete_action')}
  cancelLabel={t('prt_cancel')}
  onconfirm={remove}
/>
