<script lang="ts">
  // v3 `task-canvas/RuleNode.svelte`: a rule is its own entity, drawn in a distinct (amber) shape to
  // say "this fires by itself": a bolt, its name, an "auto" badge, its trigger and what it runs.
  // Click selects it (the right pane opens its editor). When the task it runs sets the stage, its
  // exit dot draws a dashed arrow to that stage.
  import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
  import GitBranchPlus from '@lucide/svelte/icons/git-branch-plus';
  import ProvenanceMark from '../shared/ProvenanceMark.svelte';
  import { ELEMENT_KINDS } from '../shared/provenance-elements';
  import { infoOf } from './provenance';
  import Zap from '@lucide/svelte/icons/zap';
  import { getBuilderContext } from '../shell/context';
  import { getCanvasState } from './context';
  import type { RuleChip } from './model';
  import { outcomeParts } from '../rule/summary';

  type RuleNodeType = Node<{ rule: RuleChip }, 'rule'>;
  let { data }: NodeProps<RuleNodeType> = $props();
  const ctx = getBuilderContext();
  const canvas = getCanvasState();
  const rule = $derived(data.rule);
  const selected = $derived(ctx.selection().kind === 'rule' && ctx.selection().id === rule.key);
  const select = (): void => ctx.select({ kind: 'rule', id: rule.key });
  const info = $derived(infoOf(ctx, { kind: ELEMENT_KINDS.rule, key: rule.key }));

  /** The own task's `then` steps in one line (C-004): what the automatic action does, not which task it runs. */
  const outcome = $derived(
    rule.owns
      ? outcomeParts(ctx.doc().effective(), rule.run, ctx.type, ctx.locale, {
          yes: ctx.t('outcome_yes'),
          no: ctx.t('outcome_no'),
          empty: ctx.t('outcome_empty'),
          lifecycle: ctx.t('outcome_lifecycle'),
        }).join(' · ')
      : '',
  );

  const trigger = $derived.by(() => {
    const tr = rule.trigger;
    switch (tr.kind) {
      case 'after':
        return ctx.t('rules_trigger_after', { task: tr.task });
      case 'change':
        return ctx.t('rules_trigger_change', { property: tr.property, type: tr.type });
      case 'edge':
        return ctx.t('rules_trigger_edge', { condition: tr.condition });
      case 'elapsed':
        return ctx.t('rules_trigger_elapsed', { from: tr.from });
      case 'schedule':
        return ctx.t('rules_trigger_schedule', { schedule: tr.schedule });
    }
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="rule-node"
  class:selected
  data-rule-key={rule.key}
  role="group"
  tabindex="0"
  aria-current={selected ? 'true' : undefined}
  aria-label={rule.label}
  oncontextmenu={(e) =>
    canvas.openMenu(e, ctx.t('canvas_menu_label', { name: rule.label }), canvas.ruleMenu(rule.key))}
  onclick={(e) => {
    e.stopPropagation();
    select();
  }}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select();
    }
  }}
>
  <div class="rule-head">
    <Zap class="icon rule-icon" />
    <span class="rule-name">{rule.label}</span>
    {#if info !== undefined}<ProvenanceMark t={ctx.t} {info} compact />{/if}
    {#if rule.spawns}
      <span role="img" title={ctx.t('canvas_spawns')} aria-label={ctx.t('canvas_spawns')}>
        <GitBranchPlus class="icon spawns" />
      </span>
    {/if}
    <span class="badge">{ctx.t('canvas_auto')}</span>
  </div>
  <div class="rule-trigger">{trigger}</div>
  {#if rule.owns}
    <div class="rule-outcome" data-testid="rule-outcome">
      {outcome === '' ? ctx.t('outcome_none') : outcome}
    </div>
  {:else}
    <div class="rule-run">{ctx.t('canvas_run', { task: rule.runLabel })}</div>
  {/if}
  <Handle type="source" id={rule.key} position={Position.Right} class="exit-dot rule" />
</div>
