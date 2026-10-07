<script lang="ts">
  // The ⋮ menu of the data page header (v3 `workflows/[workflowId]/+page.svelte:1047-1080`: an outline icon button
  // "Weitere Aktionen", items "Duplizieren" and "Aus Projekt importieren", a separator, then the destructive "Löschen" in the
  // destructive colour). The actions are the page's: it runs the calls and shows the dialogs.
  import Copy from '@lucide/svelte/icons/copy';
  import Import from '@lucide/svelte/icons/import';
  import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as DropdownMenu from '@ueberblick/ui/components/ui/dropdown-menu';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';

  let {
    locale = 'de',
    busy = false,
    onDuplicate,
    onImport,
    onDelete,
  }: {
    locale?: Locale;
    /** A copy is being made (v3 disabled "Duplizieren" meanwhile). */
    busy?: boolean;
    onDuplicate: () => void;
    onImport: () => void;
    onDelete: () => void;
  } = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);
  // The menu closes itself after the action: an action that disables its own item (a copy in progress) would otherwise
  // keep the menu open, with the page behind it locked.
  let menuOpen = $state(false);
  const run = (action: () => void) => () => {
    action();
    menuOpen = false;
  };
</script>

<DropdownMenu.Root bind:open={menuOpen}>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button variant="outline" size="sm" {...props} data-testid="data-menu" aria-label={t('data_menu_more')}>
        <EllipsisVertical class="h-4 w-4" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    <DropdownMenu.Item onclick={run(onDuplicate)} disabled={busy} data-testid="data-menu-duplicate">
      <Copy class="mr-2 h-4 w-4" />
      {t('data_menu_duplicate')}
    </DropdownMenu.Item>
    <DropdownMenu.Item onclick={run(onImport)} data-testid="data-menu-import">
      <Import class="mr-2 h-4 w-4" />
      {t('data_menu_import')}
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Item
      class="text-destructive focus:text-destructive"
      onclick={run(onDelete)}
      data-testid="data-menu-delete"
    >
      <Trash2 class="mr-2 h-4 w-4" />
      {t('data_menu_delete')}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
