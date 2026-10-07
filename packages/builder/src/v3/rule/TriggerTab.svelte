<script lang="ts">
  // v3 `AutomationConfig.svelte:325-481`, the Auslöser tab: "Auslöser-Typ" (a select of the trigger kinds) (glossary-lint-ignore: v3 file name)
  // and the fields of the kind (Von/Zu Phase, Beobachtete Felder + In Phase, Cron, Nach + Seit, Aufgabe).
  // v4's `on` is a task, a property change, `elapsed` or `schedule`; the picker writes `on` and the parts of
  // `when` it needs, so the admin never sees the rule language (`trigger.ts`). v3's "inaktiv >= Tage" on a
  // schedule has no engine form (E-26) and is not offered. "Wenn Bedingungen zutreffen" (v3 :515-531) is edited
  // with the Bedingung rows; "Nach" has Stunden, and "Seit" has "betritt Phase" with its "In Phase" pin.
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { labelOf } from '../../shell/location';
  import type { BuilderContext } from '../shell/context';
  import { stagePropertyOf } from '../catalog/ops';
  import ConditionRows from '../task/ConditionRows.svelte';
  import ScheduleFields from './ScheduleFields.svelte';
  import { pathOptions } from '../task/paths';
  import { commitRuleOps } from './commit';
  import { triggerOps } from './ops';
  import {
    DURATION_UNITS,
    type DurationUnit,
    isEntryTask,
    readRule,
    SINCES,
    type Since,
    startTrigger,
    TRIGGER_KINDS,
    type Trigger,
    type TriggerKind,
  } from './trigger';
  import { autoAt, autoOf, ownsTask } from './auto-task';

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
  const trigger = $derived(reading?.trigger);
  const kind = $derived(trigger?.kind ?? '');
  const own = $derived(auto !== undefined && ownsTask(file, rule) ? auto.task : undefined);

  const KIND_LABELS = {
    create: 'rp_kind_create',
    transition: 'rp_kind_transition',
    change: 'rp_kind_change',
    schedule: 'rp_kind_schedule',
    elapsed: 'rp_kind_elapsed',
    when: 'rp_kind_when',
    task: 'rp_kind_task',
  } as const satisfies Record<TriggerKind, string>;
  const SINCE_LABELS = {
    created: 'rp_since_created',
    changed: 'rp_since_changed',
    entered: 'rp_since_entered',
  } as const satisfies Record<Since, string>;
  const UNIT_LABELS = {
    hours: 'rp_unit_hours',
    days: 'rp_unit_days',
    months: 'rp_unit_months',
  } as const satisfies Record<DurationUnit, string>;

  const stageOptions = $derived(
    Object.entries(
      env.stage === undefined ? {} : (file.types?.[ctx.type]?.properties[env.stage]?.options ?? {}),
    ).map(([key, l]) => ({ key, name: labelOf(l, ctx.locale, key) })),
  );
  const properties = $derived(
    Object.entries(file.types?.[ctx.type]?.properties ?? {}).map(([key, p]) => ({
      key,
      name: labelOf(p.label, ctx.locale, key),
    })),
  );
  const entries = $derived(
    Object.entries(file.tasks ?? {})
      .filter(([, d]) => isEntryTask(d, ctx.type))
      .map(([key, d]) => ({ key, name: labelOf(d.label, ctx.locale, key) })),
  );
  const tasks = $derived(
    Object.entries(file.tasks ?? {})
      .filter(([key, d]) => key !== own && !isEntryTask(d, ctx.type))
      .map(([key, d]) => ({ key, name: labelOf(d.label, ctx.locale, key) })),
  );

  const paths = $derived(pathOptions(file, auto?.task ?? '', ctx.locale, t('tp_path_actor')));
  let error: string | undefined = $state();
  function write(next: Trigger | undefined): void {
    if (next === undefined) return void (error = t('rp_kind_unavailable'));
    const ops = triggerOps(doc, rule, next, env);
    error = ops === undefined ? t('rp_no_process') : commitRuleOps(ctx, ops, [autoAt(rule)]);
  }
  const unavailable = (k: TriggerKind): boolean => startTrigger(k, file, env, own) === undefined;
  const reason = (k: TriggerKind): string =>
    k === 'create' ? t('rp_no_entry') : k === 'task' ? t('rp_no_task') : t('rp_no_process');

  // The typed text stays while the file refuses it; the file wins when it changes.
  let amount = $state('');
  $effect(() => {
    if (trigger?.kind === 'elapsed') amount = String(trigger.amount);
  });

  function toggle(list: readonly string[], key: string, on: boolean): string[] {
    return on ? [...list.filter((k) => k !== key), key] : list.filter((k) => k !== key);
  }
  // Keep the properties in the type's order, as v3's checkbox list.
  const ordered = (list: readonly string[]): string[] =>
    properties.map((p) => p.key).filter((k) => list.includes(k));
</script>

<div class="tab" data-testid="rule-tab-trigger">
  <p class="hint">{t('rp_intro')}</p>
  <label class="field">
    <span class="caption">{t('rp_trigger_type')}</span>
    <select
      class="select"
      data-testid="rule-trigger-kind"
      value={kind}
      onchange={(e) => write(startTrigger(e.currentTarget.value as TriggerKind, file, env, own))}
    >
      {#if trigger === undefined}<option value="" disabled>{t('rp_kind_custom')}</option>{/if}
      {#each TRIGGER_KINDS as k (k)}
        <option value={k} disabled={unavailable(k)}>
          {t(KIND_LABELS[k])}{unavailable(k) ? ` (${reason(k)})` : ''}
        </option>
      {/each}
    </select>
  </label>

  {#if trigger === undefined}
    <p class="hint" data-testid="rule-trigger-custom">{t('rp_custom_trigger')}</p>
  {:else if trigger.kind === 'create'}
    <label class="field">
      <span class="caption">{t('rp_entry')}</span>
      <select
        class="select"
        data-testid="rule-trigger-task"
        value={trigger.task}
        onchange={(e) => write({ kind: 'create', task: e.currentTarget.value })}
      >
        {#each entries as e (e.key)}<option value={e.key}>{e.name}</option>{/each}
      </select>
    </label>
  {:else if trigger.kind === 'task'}
    <label class="field">
      <span class="caption">{t('rp_task')}</span>
      <select
        class="select"
        data-testid="rule-trigger-task"
        value={trigger.task}
        onchange={(e) => write({ kind: 'task', task: e.currentTarget.value })}
      >
        {#each tasks as k (k.key)}<option value={k.key}>{k.name}</option>{/each}
      </select>
    </label>
  {:else if trigger.kind === 'transition'}
    {@const tr = trigger}
    <label class="field">
      <span class="caption">{t('rp_from_stage')}</span>
      <select
        class="select"
        data-testid="rule-trigger-from"
        value={tr.from}
        onchange={(e) => write({ ...tr, from: e.currentTarget.value })}
      >
        <option value="">{t('rp_any_stage')}</option>
        {#each stageOptions as s (s.key)}<option value={s.key}>{s.name}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span class="caption">{t('rp_to_stage')}</span>
      <select
        class="select"
        data-testid="rule-trigger-to"
        value={tr.to}
        onchange={(e) => write({ ...tr, to: e.currentTarget.value })}
      >
        <option value="">{t('rp_any_stage')}</option>
        {#each stageOptions as s (s.key)}<option value={s.key}>{s.name}</option>{/each}
      </select>
    </label>
  {:else if trigger.kind === 'change'}
    {@const tr = trigger}
    <fieldset class="field fields" data-testid="rule-trigger-fields">
      <legend class="caption">{t('rp_watch')}</legend>
      <div class="checks">
        {#each properties as p (p.key)}
          <label class="check">
            <input
              type="checkbox"
              data-testid={`rule-watch-${p.key}`}
              checked={tr.properties.includes(p.key)}
              onchange={(e) =>
                write({ ...tr, properties: ordered(toggle(tr.properties, p.key, e.currentTarget.checked)) })}
            />
            {p.name}
          </label>
        {/each}
      </div>
    </fieldset>
    <label class="field">
      <span class="caption">{t('rp_in_stage')}</span>
      <select
        class="select"
        data-testid="rule-trigger-in-stage"
        value={tr.stage}
        disabled={env.stage === undefined}
        onchange={(e) => write({ ...tr, stage: e.currentTarget.value })}
      >
        <option value="">{t('rp_any_stage')}</option>
        {#each stageOptions as s (s.key)}<option value={s.key}>{s.name}</option>{/each}
      </select>
    </label>
  {:else if trigger.kind === 'elapsed'}
    {@const tr = trigger}
    <label class="field">
      <span class="caption">{t('rp_after')}</span>
      <span class="pair">
        <Input
          type="number"
          min="0"
          step="1"
          data-testid="rule-trigger-after"
          bind:value={amount}
          onchange={(e) => {
            const n = Number(e.currentTarget.value);
            if (Number.isInteger(n) && n >= 0) write({ ...tr, amount: n });
            else error = t('rp_after_invalid');
          }}
        />
        <select
          class="select"
          aria-label={t('rp_after')}
          data-testid="rule-trigger-unit"
          value={tr.unit}
          onchange={(e) => write({ ...tr, unit: e.currentTarget.value as typeof tr.unit })}
        >
          {#each DURATION_UNITS as u (u)}<option value={u}>{t(UNIT_LABELS[u])}</option>{/each}
        </select>
      </span>
    </label>
    <label class="field">
      <span class="caption">{t('rp_since')}</span>
      <select
        class="select"
        data-testid="rule-trigger-since"
        value={tr.since}
        onchange={(e) => {
          const since = e.currentTarget.value as Since;
          write({ ...tr, since, stage: since === 'entered' ? tr.stage : '' });
        }}
      >
        {#each SINCES as s (s)}
          <option value={s} disabled={s === 'entered' && env.stage === undefined}>
            {t(SINCE_LABELS[s])}{s === 'entered' && env.stage === undefined ? ` (${t('rp_no_process')})` : ''}
          </option>
        {/each}
      </select>
    </label>
    {#if tr.since === 'entered'}
      <label class="field">
        <span class="caption">{t('rp_in_stage')}</span>
        <select
          class="select"
          data-testid="rule-trigger-entered-stage"
          value={tr.stage}
          onchange={(e) => write({ ...tr, stage: e.currentTarget.value })}
        >
          <option value="">{t('rp_any_stage')}</option>
          {#each stageOptions as s (s.key)}<option value={s.key}>{s.name}</option>{/each}
        </select>
      </label>
    {/if}
    <p class="hint">{t('rp_server_only')}</p>
  {:else if trigger.kind === 'when'}
    {@const tr = trigger}
    <div data-testid="rule-trigger-when">
      <ConditionRows
        id={`rule-${rule}-when`}
        source={tr.condition}
        {paths}
        {t}
        intro={t('rp_when_intro')}
        empty={t('rp_when_required')}
        apply={(src) => {
          if (src.trim() === '') return t('rp_when_required');
          write({ kind: 'when', condition: src });
          return undefined;
        }}
      />
    </div>
    <p class="hint">{t('rp_server_only')}</p>
  {:else if trigger.kind === 'schedule'}
    <ScheduleFields
      {trigger}
      {stageOptions}
      hasStage={env.stage !== undefined}
      {t}
      {write}
      fail={(m) => (error = m)}
    />
  {/if}

  {#if error !== undefined}<p class="error" role="alert" data-testid="rule-error">{error}</p>{/if}
</div>

<style>
  .tab {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: none;
  }
  .caption,
  .hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .select {
    min-width: 0;
    height: 2.25rem;
    padding: 0 0.5rem;
    font-size: 0.875rem;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
  }
  .error {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--destructive);
  }
  @media (max-width: 640px) {
    .select {
      height: 2.75rem;
      font-size: 1rem;
    }
    .check {
      font-size: 0.875rem;
      min-height: 2.75rem;
    }
  }
</style>
