<script lang="ts">
  // v3's delete dialog (crud-dialogs.svelte "Delete Dialog": title, one confirm sentence, Abbrechen and a red Löschen).
  // Done better: v3 silently removed the role from the participants and from the layers; in v4 the Doc names what still
  // uses the role (rules, permissions, views) and the roster names who has it, so the admin decides knowing both.
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { DeletePreview } from './types';

  let {
    open = $bindable(false),
    locale,
    preview,
    onconfirm,
  }: {
    open?: boolean;
    locale: Locale;
    /** What the Doc and the roster say about them; null while it is being read. */
    preview: DeletePreview | null;
    onconfirm: () => void | Promise<void>;
  } = $props();

  const t = (key: Parameters<typeof adminMessage>[1], values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{t('rol_delete')}</AlertDialog.Title>
      <AlertDialog.Description>{t('rol_delete_confirm')}</AlertDialog.Description>
    </AlertDialog.Header>
    {#if preview && preview.people.length > 0}
      <p class="text-sm" data-testid="delete-people">
        {t('rol_delete_people', {
          count: preview.people.length,
          names: preview.people.map((p) => p.name).join(', '),
        })}
      </p>
    {/if}
    {#if preview && preview.uses.length > 0}
      <div class="space-y-2 text-sm" data-testid="delete-uses">
        <p class="font-medium">{t('rol_delete_uses')}</p>
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
      <AlertDialog.Cancel>{t('rol_cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => void onconfirm()}
        disabled={preview === null}
        class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
      >
        {t('rol_delete_action')}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
