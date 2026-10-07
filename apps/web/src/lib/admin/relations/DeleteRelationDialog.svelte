<script lang="ts">
  // v3's delete dialog (`relations/+page.svelte:399-446`: title, one confirm sentence, Abbrechen and a red Löschen).
  // Done better: v3 counted only the related fields in the child's tasks. Here the dialog also says how many features
  // hold the relation (one grouped query on the server) and lists what the Doc says still names it.
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { DeletePreview } from './types';

  let {
    open = $bindable(false),
    locale,
    preview,
    holding,
    onconfirm,
  }: {
    open?: boolean;
    locale: Locale;
    /** What the Doc says about the deletion; null while it is being read. */
    preview: DeletePreview | null;
    /** How many features hold the relation; null while it is being counted. */
    holding: number | null;
    onconfirm: () => void | Promise<void>;
  } = $props();

  const t = (key: Parameters<typeof adminMessage>[1], values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{t('rel_delete')}</AlertDialog.Title>
      <AlertDialog.Description>{t('rel_delete_confirm')}</AlertDialog.Description>
    </AlertDialog.Header>
    {#if holding !== null && holding > 0}
      <p class="text-sm font-medium text-destructive" data-testid="delete-features">
        {t('rel_delete_features', { count: holding })}
      </p>
    {/if}
    {#if preview && preview.uses.length > 0}
      <div class="space-y-2 text-sm" data-testid="delete-uses">
        <p class="font-medium">{t('rel_delete_uses')}</p>
        <ul class="max-h-40 space-y-1 overflow-auto rounded-md border bg-muted/20 p-3">
          {#each preview.uses as use, i (i)}
            <li>
              <span class="font-mono text-xs text-muted-foreground">{use.path}</span>
              <span class="block">{use.message}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{t('rel_cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => void onconfirm()}
        disabled={preview === null}
        class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
      >
        {t('rel_delete_action')}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
