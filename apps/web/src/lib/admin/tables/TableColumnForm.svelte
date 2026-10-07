<script lang="ts">
  // The create and edit dialogs of v3's column manager (`custom-field-manager-generic.svelte:262-460`) with the table
  // page's labels (`customTableEdit*`): Spaltenname, Datentyp (a menu with a check mark on the current one), Standardwert,
  // Pflichtfeld. One component for both, as the two v3 dialogs were the same form.
  import { untrack } from 'svelte';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Checkbox } from '@ueberblick/ui/components/ui/checkbox';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import * as DropdownMenu from '@ueberblick/ui/components/ui/dropdown-menu';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { ColumnForm } from '../columns/form';

  let {
    open = $bindable(false),
    locale,
    mode,
    form,
    types,
    problem = null,
    onsubmit,
  }: {
    open?: boolean;
    locale: Locale;
    mode: 'create' | 'edit';
    form: ColumnForm;
    types: readonly string[];
    problem?: string | null;
    onsubmit: (form: ColumnForm) => void | Promise<void>;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  const typeLabel = (type: string): string => t(`prt_type_${type}` as AdminKey);
  let draft = $state<ColumnForm>(untrack(() => ({ ...form })));
  const uid = $props.id();

  $effect(() => {
    if (open) draft = { ...form };
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>
        {mode === 'create' ? t('tbl_col_add_title') : t('tbl_col_edit_title', { name: form.label || '' })}
      </Dialog.Title>
    </Dialog.Header>
    <form
      novalidate
      onsubmit={(e) => {
        e.preventDefault();
        void onsubmit({ ...draft });
      }}
    >
      <div class="grid gap-4 py-4">
        {#if problem}<p role="alert" class="text-sm text-destructive">{problem}</p>{/if}
        <div class="grid gap-2">
          <Label for="{uid}-name">{t('tbl_col_label')}</Label>
          <Input id="{uid}-name" bind:value={draft.label} placeholder={t('tbl_col_label_ph')} required />
          {#if mode === 'create'}<p class="text-xs text-muted-foreground">{t('tbl_col_label_hint')}</p>{/if}
        </div>
        <div class="grid gap-2">
          <Label for="{uid}-type">{t('tbl_col_type')}</Label>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="outline" class="w-full justify-between" id="{uid}-type">
                  {draft.type ? typeLabel(draft.type) : t('tbl_col_select_type')}
                  <ChevronDown class="ml-2 h-4 w-4 opacity-50" />
                </Button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content class="w-full">
              {#each types as type (type)}
                <DropdownMenu.Item onclick={() => (draft.type = type)}>
                  {#if draft.type === type}<Check class="mr-2 h-4 w-4" />{:else}<span class="mr-2 h-4 w-4"
                    ></span>{/if}
                  {typeLabel(type)}
                </DropdownMenu.Item>
              {/each}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
        <div class="grid gap-2">
          <Label for="{uid}-default">{t('tbl_col_default')}</Label>
          <Input id="{uid}-default" bind:value={draft.defaultText} placeholder={t('tbl_col_default_ph')} />
        </div>
        <div class="flex items-center gap-2">
          <Checkbox id="{uid}-required" bind:checked={draft.required} />
          <Label for="{uid}-required" class="cursor-pointer text-sm font-normal"
            >{t('tbl_col_required')}</Label
          >
        </div>
      </div>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (open = false)}>{t('tbl_cancel')}</Button>
        <Button type="submit"
          >{mode === 'create' ? t('tbl_col_create_action') : t('tbl_col_save_action')}</Button
        >
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
