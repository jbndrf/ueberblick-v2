<script lang="ts">
  // v3 `AutomationConfig.svelte:466-481`: the "Feuert, solange diese Bedingungen gelten" rows (glossary-lint-ignore: v3 file name)
  // (`SentryEditor`). The rows are the task pane's Bedingungen rows (R1) over the part of the entry's `when`
  // the Auslöser did not write; a condition the rows cannot say stays text, as there. An entry without a timing
  // fires when its `when` turns true: that one condition is the Auslöser's, so there are no separate rows.
  import type { BuilderContext } from '../shell/context';
  import { stagePropertyOf } from '../catalog/ops';
  import ConditionRows from '../task/ConditionRows.svelte';
  import { pathOptions } from '../task/paths';
  import { commitRuleOps } from './commit';
  import { conditionOps } from './ops';
  import { autoAt, autoOf } from './auto-task';
  import { readRule } from './trigger';

  interface Props {
    ctx: BuilderContext;
    rule: string;
  }
  let { ctx, rule }: Props = $props();

  const t = $derived(ctx.t);
  const doc = $derived(ctx.doc());
  const file = $derived(doc.effective());
  const auto = $derived(autoOf(file, rule));
  const def = $derived(auto?.entry);
  const env = $derived({ type: ctx.type, stage: stagePropertyOf(file, ctx.type) });
  const reading = $derived(def === undefined ? undefined : readRule(file, def, env));
  const rest = $derived(reading?.rest);
  const edge = $derived(reading?.trigger?.kind === 'when');
  const paths = $derived(pathOptions(file, auto?.task ?? '', ctx.locale, t('tp_path_actor')));
</script>

<div class="tab" data-testid="rule-tab-condition">
  {#if edge}
    <p class="hint" data-testid="rule-cond-edge">{t('rp_cond_edge')}</p>
  {:else}
    <ConditionRows
      id={`rule-${rule}`}
      source={rest}
      {paths}
      {t}
      intro={t('rp_cond_intro')}
      empty={t('rp_cond_empty')}
      apply={(src) => commitRuleOps(ctx, conditionOps(doc, rule, src, env), [autoAt(rule)])}
    />
  {/if}
</div>

<style>
  .tab {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
</style>
