<script lang="ts">
  // v3 `AutomationConfig.svelte:483-575`, the Schritte tab: the steps an automation runs, each with its (glossary-lint-ignore: v3 file name)
  // conditions ("Wenn") and its actions ("Dann"). In v4 an automatic action belongs to a task and the steps are
  // that task's `then` (lead-a decision of WP-377): an action with its own task embeds the task pane's Ergebnisse
  // list (R1), where "immer / nur wenn … / sonst" is v3's step condition and execution mode. An action on a task
  // other actions or people use shows the task, its values and "Aufgabe öffnen" instead: editing it here would
  // change the shared task unnoticed. The task is the one the entry sits in; it cannot be changed here.
  import { labelOf } from '../../shell/location';
  import type { BuilderContext } from '../shell/context';
  import OutcomesTab from '../task/OutcomesTab.svelte';
  import { autoOf, ownsTask, rulesRunning } from './auto-task';

  interface Props {
    ctx: BuilderContext;
    rule: string;
  }
  let { ctx, rule }: Props = $props();

  const t = $derived(ctx.t);
  const doc = $derived(ctx.doc());
  const file = $derived(doc.effective());
  const run = $derived(autoOf(file, rule)?.task ?? '');
  const own = $derived(ownsTask(file, rule));
  const others = $derived(rulesRunning(file, run).filter((r) => r !== rule));
  const runName = $derived(labelOf(file.tasks?.[run]?.label, ctx.locale, run));
  // A step that acts on other features (`of`, WP-374) is not editable in the list yet; it stays and shows here.
  const targets = $derived(
    (file.tasks?.[run]?.then ?? []).flatMap((step, i) =>
      step.of === undefined ? [] : [{ n: i + 1, of: step.of }],
    ),
  );
</script>

<div class="tab" data-testid="rule-tab-steps">
  {#if own}
    <p class="hint" data-testid="rule-own-note">{t('rp_steps_own')}</p>
    <OutcomesTab {ctx} task={run} />
    {#if targets.length > 0}
      <ul class="targets" data-testid="rule-step-targets">
        {#each targets as step (step.n)}
          <li class="hint">{t('rp_step_target', { n: step.n, of: step.of })}</li>
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="field">
      <span class="caption">{t('rp_run_task')}</span>
      <span data-testid="rule-run-task">{runName}</span>
    </p>
    <p class="hint" data-testid="rule-shared-note">
      {others.length > 0 ? t('rp_shared_rules') : t('rp_shared_task')}
    </p>
    <button
      type="button"
      class="open"
      data-testid="rule-open-task"
      disabled={file.tasks?.[run] === undefined}
      onclick={() => ctx.select({ kind: 'task', id: run })}
    >
      {t('rp_open_task')}
    </button>
  {/if}
</div>

<style>
  .tab {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .targets {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .caption,
  .hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .open {
    align-self: flex-start;
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
    color: var(--foreground);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    cursor: pointer;
  }
  .open:hover:not(:disabled) {
    background: var(--accent);
  }
  @media (max-width: 640px) {
    .open {
      height: 2.75rem;
      font-size: 1rem;
    }
  }
</style>
