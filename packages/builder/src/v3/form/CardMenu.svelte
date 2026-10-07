<script lang="ts">
  import { copyText } from '../shared/clipboard';
  // v3's right-click menu of a field card (`Deletable`): Aus Formular entfernen, Feld vollständig löschen (not for the
  // process property), Schlüssel kopieren. The "⋯" button opens it too, so a phone has it.
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import * as DropdownMenu from '@ueberblick/ui/components/ui/dropdown-menu';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { Translate } from '../../shell/messages';
  import { canReset, hidesInsteadOfDeletes } from '../shared/provenance';
  import { useProvenance } from '../shared/provenance-context';

  interface Props {
    t: Translate;
    label: string;
    keyName: string;
    open: boolean;
    protectedKey: boolean;
    onremove: () => void;
    ondelete: () => void;
  }
  let { t, label, keyName, open = $bindable(), protectedKey, onremove, ondelete }: Props = $props();

  let copied = $state(false);
  // Where the field comes from (the card provides it): a changed one can go back to the template; deleting a
  // template field hides it, so the entry says so (the engine's `hide`, WP-445).
  const provenance = useProvenance();
  const info = $derived(provenance?.info());
  const locked = $derived(info?.lock !== undefined);

  async function copyKey(): Promise<void> {
    if (await copyText(keyName)) {
      copied = true;
      setTimeout(() => (copied = false), 1500);
    }
  }
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger>
    {#snippet child({ props }: { props: HTMLButtonAttributes })}
      <button
        {...props}
        type="button"
        class="icon-btn"
        data-testid="field-menu"
        aria-label={t('form_menu_more', { label })}><Ellipsis size={16} /></button
      >
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    <DropdownMenu.Item data-testid="menu-remove" onclick={onremove}>{t('form_menu_remove')}</DropdownMenu.Item
    >
    {#if canReset(info)}
      <DropdownMenu.Item
        data-testid="menu-reset"
        disabled={locked}
        title={info?.lock === undefined ? undefined : t('prov_locked', { lock: info.lock })}
        onclick={() => provenance?.reset()}
      >
        {t('prov_reset')}
      </DropdownMenu.Item>
    {/if}
    {#if !protectedKey}
      <DropdownMenu.Item
        class="text-destructive"
        data-testid="menu-delete"
        disabled={locked}
        onclick={ondelete}
      >
        {hidesInsteadOfDeletes(info) ? t('prov_hide') : t('form_menu_delete')}
      </DropdownMenu.Item>
    {/if}
    <DropdownMenu.Separator />
    <DropdownMenu.Item data-testid="menu-copy-key" onclick={copyKey}>
      {copied ? t('tp_key_copied') : t('form_menu_copy_key')}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
