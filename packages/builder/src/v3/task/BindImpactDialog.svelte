<script lang="ts">
  // v3 `ConfirmDeleteDialog.svelte` listed the dependents of a delete (`deletion.ts`); here the refusal of a
  // remove or rename of a bind (A-053) shows the same list: the form entries and the expressions that would
  // stop working. Nothing to confirm: the admin takes those out first, so the one button closes.
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import type { Translate } from '../../shell/messages';
  import type { BindImpact } from './bind-impact';

  interface Props {
    open: boolean;
    t: Translate;
    name: string;
    /** What was refused. */
    action: 'remove' | 'rename';
    impact: BindImpact;
  }
  let { open = $bindable(false), t, name, action, impact }: Props = $props();
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content data-testid="bind-impact">
    <AlertDialog.Header>
      <AlertDialog.Title>{t('tp_bind_in_use_title', { name })}</AlertDialog.Title>
      <AlertDialog.Description
        >{t(action === 'remove' ? 'tp_bind_in_use_remove' : 'tp_bind_in_use_rename', {
          name,
        })}</AlertDialog.Description
      >
    </AlertDialog.Header>
    <div class="impact">
      <p>{t('tp_bind_in_use_lead')}</p>
      {#if impact.fields.length > 0}
        <p class="sub">{t('tp_bind_in_use_fields')}</p>
        <ul data-testid="bind-impact-fields">
          {#each impact.fields as field (field)}<li>{field}</li>{/each}
        </ul>
      {/if}
      {#if impact.expressions.length > 0}
        <p class="sub">{t('tp_bind_in_use_expressions')}</p>
        <ul data-testid="bind-impact-expressions">
          {#each impact.expressions as line (line)}<li>{line}</li>{/each}
        </ul>
      {/if}
    </div>
    <AlertDialog.Footer>
      <AlertDialog.Cancel data-testid="bind-impact-close">{t('tp_bind_in_use_close')}</AlertDialog.Cancel>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
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
  .impact .sub {
    margin-top: 0.5rem;
    color: var(--foreground);
    font-weight: 600;
  }
  .impact ul {
    margin: 0;
    padding-left: 1.25rem;
    list-style: disc;
    overflow-wrap: anywhere;
  }
</style>
