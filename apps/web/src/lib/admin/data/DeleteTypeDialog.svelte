<script lang="ts">
  // "Objektart löschen" (v3 `workflows/[workflowId]/+page.svelte:1127-1217`): an alert dialog that says what goes with the
  // type (Stufen, Regeln … and the data: Objekte and recorded values) and, when Objekte exist, asks for their number before
  // "Löschen" enables. v3 deleted at once; here the type leaves the draft and goes for good with "Veröffentlichen" (the deploy
  // overview then names the Objekte), so the text says so. Counts load when the dialog opens ("Abhängigkeiten werden geladen…").
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { MenuApi } from './menu-api';
  import type { DeleteCounts } from './menu-types';

  let {
    open = $bindable(false),
    locale = 'de',
    name,
    api,
    onRemoved,
  }: {
    open?: boolean;
    locale?: Locale;
    name: string;
    api: MenuApi;
    /** The type is out of the draft; `notes` are the problems the removal leaves. */
    onRemoved: (notes: readonly string[]) => void | Promise<void>;
  } = $props();
  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  let counts = $state<DeleteCounts | null>(null);
  let loading = $state(false);
  let confirm = $state('');
  let deleting = $state(false);

  $effect(() => {
    if (open && counts === null && !loading) {
      loading = true;
      void api.call({ action: 'counts' }).then((r) => {
        loading = false;
        if (!r.ok) toast.error(r.message);
        else if (r.answer.kind === 'counts') counts = r.answer.counts;
      });
    }
    if (!open) {
      counts = null;
      confirm = '';
    }
  });

  // v3: with no Objekte the button is on at once; with some, the typed number must match.
  const confirmed = $derived(
    counts !== null && (counts.objects === 0 || confirm.trim() === String(counts.objects)),
  );
  const config = $derived(
    counts === null
      ? []
      : [
          { n: counts.stages, key: 'data_menu_count_stages' as const },
          { n: counts.tasks, key: 'data_menu_count_tasks' as const },
          { n: counts.rules, key: 'data_menu_count_rules' as const },
          { n: counts.views, key: 'data_menu_count_views' as const },
        ].filter((r) => r.n > 0),
  );
  const data = $derived(
    counts === null
      ? []
      : [
          { n: counts.objects, key: 'data_menu_count_objects' as const },
          { n: counts.values, key: 'data_menu_count_values' as const },
        ].filter((r) => r.n > 0),
  );

  async function remove(): Promise<void> {
    if (deleting || !confirmed) return;
    deleting = true;
    const r = await api.call({ action: 'remove' });
    deleting = false;
    open = false;
    if (!r.ok) return void toast.error(r.message);
    if (r.answer.kind !== 'removed') return;
    toast.success(t('data_menu_delete_success'));
    await onRemoved(r.answer.notes);
  }
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content data-testid="delete-type-dialog">
    <AlertDialog.Header>
      <AlertDialog.Title>{t('data_menu_delete_title')}</AlertDialog.Title>
      <AlertDialog.Description>{t('data_menu_delete_intro', { name })}</AlertDialog.Description>
    </AlertDialog.Header>
    <div class="space-y-3 text-sm">
      {#if loading && counts === null}
        <div class="text-muted-foreground">{t('data_menu_delete_loading')}</div>
      {:else if counts !== null}
        {#if config.length === 0 && data.length === 0}
          <div class="text-muted-foreground">{t('data_menu_delete_none')}</div>
        {:else}
          <div class="font-medium">{t('data_menu_delete_also')}</div>
          <ul class="list-disc space-y-0.5 pl-5 text-muted-foreground" data-testid="delete-type-counts">
            {#each config as row (row.key)}
              <li>{t(row.key, { n: row.n })}</li>
            {/each}
            {#if data.length > 0}
              <li class="font-semibold text-foreground">
                {data.map((row) => t(row.key, { n: row.n })).join(' · ')}
              </li>
            {/if}
          </ul>
        {/if}
        {#if counts.objects > 0}
          <div class="space-y-2 border-t pt-2">
            <label for="type-delete-confirm" class="block text-sm">{t('data_menu_delete_prompt')}</label>
            <input
              id="type-delete-confirm"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              bind:value={confirm}
              placeholder={t('data_menu_delete_placeholder')}
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              data-testid="delete-type-confirm"
            />
          </div>
        {/if}
        <p class="text-muted-foreground">{t('data_menu_delete_publish')}</p>
      {/if}
    </div>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={deleting}>{t('data_menu_cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action
        class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
        onclick={() => void remove()}
        disabled={deleting || !confirmed}
        data-testid="delete-type-submit"
      >
        {t('data_menu_delete_button')}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
