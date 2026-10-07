<script lang="ts">
  // v3 `workflow-builder/components/ConfirmDeleteDialog.svelte`: the one confirm dialog of every "delete
  // entirely": the entity's title, what else is affected, Abbrechen / Löschen. In v4 a delete does not
  // cascade; the rules that run the task stay and show as problems, so the list names them.
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import type { Translate } from '../../shell/messages';

  interface Props {
    open: boolean;
    t: Translate;
    title: string;
    /** The labels of what is left dangling. */
    impact: readonly string[];
    onconfirm: () => void;
    /** The line over the impact list; the task delete's by default. */
    impactLead?: string | undefined;
    /** A task of the template is hidden, not deleted: the dialog says what happens (WP-445). */
    hide?: boolean;
    /** What hiding means for this element, when it is not a task (WP-454: a rule, a stage). */
    hideBody?: string | undefined;
  }
  let {
    open = $bindable(false),
    t,
    title,
    impact,
    onconfirm,
    impactLead,
    hide = false,
    hideBody,
  }: Props = $props();
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content data-testid="confirm-delete">
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      <AlertDialog.Description
        >{hide ? (hideBody ?? t('tp_hide_body')) : t('tp_delete_body')}</AlertDialog.Description
      >
    </AlertDialog.Header>
    {#if impact.length > 0}
      <div class="impact">
        <p>{impactLead ?? t('tp_delete_impact')}</p>
        <ul>
          {#each impact as line (line)}<li>{line}</li>{/each}
        </ul>
      </div>
    {/if}
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{t('tp_cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action class="confirm-danger" data-testid="confirm-delete-action" onclick={onconfirm}>
        {hide ? t('prov_hide') : t('tp_delete_confirm')}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
  :global(.confirm-danger) {
    background: var(--destructive);
    color: #fff;
  }
  :global(.confirm-danger:hover) {
    background: color-mix(in oklab, var(--destructive) 90%, transparent);
  }
  .impact {
    padding: 0.75rem;
    font-size: 0.875rem;
    border: 1px solid color-mix(in oklab, var(--destructive) 30%, transparent);
    border-radius: 0.375rem;
    background: color-mix(in oklab, var(--destructive) 5%, transparent);
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
