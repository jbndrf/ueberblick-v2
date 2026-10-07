<script lang="ts">
  // v3's "Tabelle bearbeiten" dialog (`custom-tables/+page.svelte:326-419`), opened by "Bearbeiten" in the row menu:
  // Tabellenname, Anzeigename, Beschreibung, Hauptspalte and "Sichtbar für Rollen" (v3's MobileMultiSelect), Cancel and Save.
  // The table name is the type's key and a key never changes, so it is shown but not editable (v3 renamed the table);
  // the Hauptspalte renames the first column's label (Q15: it is the first column, there is no separate setting).
  import { untrack } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { MultiSelect, type MultiSelectOption } from '@ueberblick/ui/components/ui/multi-select';
  import { Textarea } from '@ueberblick/ui/components/ui/textarea';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { TableSummary } from './model';

  export interface TableValues {
    readonly name: string;
    readonly description: string;
    readonly mainColumn: string;
    readonly roles: readonly string[];
  }

  let {
    open = $bindable(false),
    locale,
    table,
    roles,
    onsave,
  }: {
    open?: boolean;
    locale: Locale;
    table: TableSummary | null;
    roles: readonly { readonly key: string; readonly label: string }[];
    onsave: (values: TableValues) => void | Promise<void>;
  } = $props();

  const t = (key: AdminKey): string => adminMessage(locale, key);
  const uid = $props.id();
  let name = $state('');
  let description = $state('');
  let mainColumn = $state('');
  let picked = $state<string[]>([]);
  let touched = $state(false);
  const options = $derived<MultiSelectOption[]>(roles.map((r) => ({ value: r.key, label: r.label })));

  // Fresh values each time the dialog opens for a table (a reload under it must not reset what is typed).
  $effect(() => {
    if (open && table)
      untrack(() => {
        name = table.label;
        description = table.description;
        mainColumn = table.mainLabel;
        picked = table.audience.kind === 'roles' ? [...table.audience.roles] : [];
        touched = false;
      });
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    touched = true;
    if (name.trim() === '' || mainColumn.trim() === '') return;
    void onsave({ name, description, mainColumn, roles: [...picked] });
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{t('tbl_edit')}</Dialog.Title>
    </Dialog.Header>
    {#if table}
      <form onsubmit={submit} novalidate>
        <div class="grid gap-4 py-4">
          <div class="grid gap-2">
            <Label for="{uid}-key">{t('tbl_col_name')}</Label>
            <Input id="{uid}-key" value={table.key} disabled />
          </div>
          <div class="grid gap-2">
            <Label for="{uid}-name">{t('tbl_col_display')}</Label>
            <Input
              id="{uid}-name"
              bind:value={name}
              placeholder={t('tbl_display_ph')}
              aria-invalid={touched && name.trim() === ''}
              required
            />
          </div>
          <div class="grid gap-2">
            <Label for="{uid}-desc">{t('tbl_col_desc')}</Label>
            <Textarea id="{uid}-desc" bind:value={description} placeholder={t('tbl_desc_ph')} rows={3} />
          </div>
          <div class="grid gap-2">
            <Label for="{uid}-main">{t('tbl_col_main')}</Label>
            <Input
              id="{uid}-main"
              bind:value={mainColumn}
              placeholder={t('tbl_main_ph')}
              aria-invalid={touched && mainColumn.trim() === ''}
              required
            />
            <p class="text-xs text-muted-foreground">{t('tbl_main_help')}</p>
          </div>
          <div class="grid gap-2">
            <Label>{t('tbl_col_roles')}</Label>
            <MultiSelect
              disablePortal
              bind:selected={picked}
              {options}
              labels={{ placeholder: t('tbl_roles_ph') }}
            />
          </div>
        </div>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (open = false)}>{t('tbl_cancel')}</Button>
          <Button type="submit">{t('tbl_save')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
