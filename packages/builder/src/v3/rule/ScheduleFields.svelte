<script lang="ts">
  // v3's rule editor, scheduled trigger (task-canvas, lines 399-440): "Cron (5 Felder)" with its next run and
  // "Nur wenn inaktiv ≥ Tage". Cron is the entry `schedule`, the days are its `idle` (`days(N)`, WP-469); empty or 0 writes `days(0)`: every Objekt.
  import { parseCron, nextAfter } from '@ueberblick/core/rules/timing';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import type { Translate } from '../../shell/messages';
  import type { Trigger } from './trigger';

  type Schedule = Extract<Trigger, { kind: 'schedule' }>;
  interface Props {
    trigger: Schedule;
    /** The stage property's options (key to name); empty when the type has no process. */
    stageOptions: readonly { key: string; name: string }[];
    hasStage: boolean;
    t: Translate;
    write: (next: Trigger) => void;
    /** Shows `message` in the pane's error line. */
    fail: (message: string) => void;
  }
  let { trigger, stageOptions, hasStage, t, write, fail }: Props = $props();

  const CRON_EXAMPLE = '0 2 * * *';
  const IDLE_EXAMPLE = String(0);
  // The typed text stays while the file refuses it (an invalid cron); the file wins when it changes.
  let cron = $state('');
  let idle = $state('');
  $effect(() => {
    cron = trigger.cron;
    idle = trigger.idle === undefined || trigger.idle === 0 ? '' : String(trigger.idle);
  });
  const cronCheck = $derived(parseCron(cron));
  const nextRun = $derived(cronCheck.ok ? nextAfter(cronCheck.cron, new Date().toISOString()) : undefined);
  const withIdle = (days: number | undefined) => (days === undefined || days === 0 ? {} : { idle: days });
  const withStage = (stage: string | undefined) => (stage === undefined || stage === '' ? {} : { stage });
</script>

<label class="field">
  <span class="caption">{t('rp_cron')}</span>
  <Input
    data-testid="rule-trigger-cron"
    placeholder={CRON_EXAMPLE}
    bind:value={cron}
    oninput={(e) => {
      const v = e.currentTarget.value;
      if (parseCron(v).ok)
        write({ kind: 'schedule', cron: v.trim(), ...withIdle(trigger.idle), ...withStage(trigger.stage) });
    }}
  />
</label>
{#if !cronCheck.ok}
  <p class="error" role="alert" data-testid="rule-cron-error">{cronCheck.error.message}</p>
{:else if nextRun !== undefined}
  <p class="hint" data-testid="rule-cron-next">
    {t('rp_cron_next', { at: nextRun.slice(0, 16).replace('T', ' ') })}
  </p>
{/if}
<label class="field">
  <span class="caption">{t('rp_in_stage')}</span>
  <select
    class="select"
    data-testid="rule-trigger-schedule-stage"
    value={trigger.stage ?? ''}
    disabled={!hasStage}
    onchange={(e) =>
      write({
        kind: 'schedule',
        cron: trigger.cron,
        ...withIdle(trigger.idle),
        ...withStage(e.currentTarget.value),
      })}
  >
    <option value="">{t('rp_any_stage')}</option>
    {#each stageOptions as s (s.key)}<option value={s.key}>{s.name}</option>{/each}
  </select>
</label>
<label class="field">
  <span class="caption">{t('rp_idle_days')}</span>
  <Input
    type="number"
    min="0"
    step="1"
    placeholder={IDLE_EXAMPLE}
    data-testid="rule-trigger-idle"
    bind:value={idle}
    onchange={(e) => {
      const text = e.currentTarget.value.trim();
      const n = text === '' ? 0 : Number(text);
      if (!Number.isInteger(n) || n < 0) return fail(t('rp_after_invalid'));
      write({ kind: 'schedule', cron: trigger.cron, ...withIdle(n), ...withStage(trigger.stage) });
    }}
  />
  <span class="hint">{t('rp_idle_hint')}</span>
</label>
<p class="hint">{t('rp_server_only')}</p>

<style>
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
  @media (max-width: 640px) {
    .select {
      height: 2.75rem;
      font-size: 1rem;
    }
  }
  .error {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--destructive);
  }
</style>
