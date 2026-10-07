<script lang="ts">
  // v3 "Delete Layer Dialog" (`LayersSection.svelte:677-706`): title, the confirm sentence, the layer's name in bold, a red
  // badge "Dies ist die Basis-Layer" when it is a base, Abbrechen and Löschen. v4: the layer leaves the draft only; the
  // published map keeps it until the next Veröffentlichen.
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { LayerRowData } from './layers-model';

  let {
    open = $bindable(false),
    locale,
    layer,
    onconfirm,
  }: {
    open?: boolean;
    locale: Locale;
    layer: LayerRowData | null;
    onconfirm: () => void | Promise<void>;
  } = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{t('settings_layers_delete_title')}</AlertDialog.Title>
      <AlertDialog.Description>
        {t('settings_layers_delete_confirm')}
        {#if layer}
          <strong class="mt-2 block">{layer.label}</strong>
          {#if layer.kind === 'base'}
            <Badge variant="destructive" class="mt-2">{t('settings_layers_this_is_base')}</Badge>
          {/if}
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{t('settings_layers_cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => void onconfirm()}
        class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
      >
        {t('settings_layers_delete')}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
