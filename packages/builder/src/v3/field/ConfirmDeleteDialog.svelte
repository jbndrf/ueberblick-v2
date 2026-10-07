<script lang="ts">
  // v3 `workflow-builder/components/ConfirmDeleteDialog.svelte`: the confirm dialog of every "delete entirely".
  // It shows what is deleted, a list of what the deletion also removes, then Abbrechen / Löschen.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import type { Translate } from '../../shell/messages';

  interface Props {
    open: boolean;
    title: string;
    /** Already localised lines, e.g. "3 Formular(e)". */
    impact: readonly string[];
    t: Translate;
    onconfirm: () => void;
    /** A template field is hidden, not deleted: the wording says so, as the task and rule panes do (WP-490). */
    hide?: boolean;
  }
  let { open = $bindable(), title, impact, t, onconfirm, hide = false }: Props = $props();
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      <AlertDialog.Description>{hide ? t('field_hide_body') : t('field_delete_body')}</AlertDialog.Description
      >
    </AlertDialog.Header>
    {#if !hide && impact.length > 0}
      <div class="impact">
        <p>{t('field_delete_impact')}</p>
        <ul>
          {#each impact as line (line)}<li>{line}</li>{/each}
        </ul>
      </div>
    {/if}
    <AlertDialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>{t('field_delete_cancel')}</Button>
      <Button variant="destructive" onclick={onconfirm}
        >{hide ? t('prov_hide') : t('field_delete_confirm')}</Button
      >
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
  .impact {
    border: 1px solid color-mix(in oklab, var(--destructive) 30%, transparent);
    border-radius: 0.375rem;
    background: color-mix(in oklab, var(--destructive) 5%, transparent);
    padding: 0.75rem;
    font-size: 0.875rem;
  }
  .impact p {
    margin: 0 0 0.25rem;
    color: var(--muted-foreground);
  }
  .impact ul {
    margin: 0;
    padding-left: 1.25rem;
    list-style: disc;
  }
</style>
