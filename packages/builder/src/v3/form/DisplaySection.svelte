<script lang="ts">
  // v3 `FieldConfigPanel.svelte:557-678` ("Darstellung in diesem Formular"): placeholder, help text, required,
  // prefill (empty, constant, last value, computed) and "Änderung vor dem Absenden erforderlich". Copied as v3 built
  // it: native select, text commits on blur, a switch per yes/no. Dumb: the panel turns each callback into ops.
  import { untrack } from 'svelte';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { Textarea } from '@ueberblick/ui/components/ui/textarea';
  import type { MessageKey } from '../../shell/messages';
  import type { Translate } from '../../shell/messages';
  import {
    PREFILL_KINDS,
    calculateOf,
    nowSource,
    type FieldConfig,
    type Prefill,
    type PrefillKind,
  } from './config';
  import type { RulesPatch } from './constraint';

  interface Props {
    t: Translate;
    cfg: FieldConfig;
    onplaceholder: (text: string) => void;
    onhelp: (text: string) => void;
    onrequired: (on: boolean) => void;
    onprefill: (prefill: Prefill) => void;
    onrules: (patch: RulesPatch) => void;
  }
  let { t, cfg, onplaceholder, onhelp, onrequired, onprefill, onrules }: Props = $props();

  const type = $derived(cfg.property?.type);
  const hasPlaceholder = $derived(!cfg.computed);
  const now = $derived(nowSource(type));

  // Drafts: a kind that has no text yet cannot be in the file (an empty `calculate` is none), so the select and the
  // two inputs hold their own state; it resets when the file says something else than the drafts would write.
  let kind: PrefillKind = $state('empty');
  let constant = $state('');
  let expression = $state('');
  let placeholder = $state('');
  let help = $state('');
  $effect(() => {
    placeholder = cfg.placeholder;
    help = cfg.help;
  });
  $effect(() => {
    // Only the file is a dependency: typing in a draft must not reset it before the blur writes it.
    const from = { key: cfg.key, calculate: cfg.calculate, prefill: cfg.prefill, type };
    untrack(() => {
      const mine = calculateOf(
        { kind, text: kind === 'constant' ? constant : expression },
        from.key,
        from.type,
      );
      if (mine === from.calculate) return;
      kind = from.prefill.kind;
      constant = from.prefill.kind === 'constant' ? from.prefill.text : '';
      expression = from.prefill.kind === 'computed' ? from.prefill.text : '';
    });
  });

  const emit = (k: PrefillKind): void =>
    onprefill({ kind: k, text: k === 'constant' ? constant : k === 'computed' ? expression : '' });
  const changeKind = (k: PrefillKind): void => {
    kind = k;
    emit(k);
  };

  const rules = $derived(cfg.constraint.foreign ? undefined : cfg.constraint.rules);
  const kindLabel = (k: PrefillKind): string => t(`form_cfg_prefill_${k}` as MessageKey);
</script>

<section class="level" data-testid="cfg-display">
  <h4 class="title">{t('form_cfg_title')}</h4>
  <p class="hint up">{t('form_cfg_scope')}</p>

  {#if hasPlaceholder}
    <div class="row">
      <Label for="cfg-placeholder">{t('form_cfg_placeholder')}</Label>
      <Input
        id="cfg-placeholder"
        bind:value={placeholder}
        onblur={() => placeholder !== cfg.placeholder && onplaceholder(placeholder)}
        placeholder={t('form_cfg_placeholder_text')}
        data-testid="cfg-placeholder"
      />
    </div>
  {/if}

  <div class="row">
    <Label for="cfg-help">{t('form_cfg_help')}</Label>
    <Textarea
      id="cfg-help"
      bind:value={help}
      onblur={() => help !== cfg.help && onhelp(help)}
      placeholder={t('form_cfg_help_placeholder')}
      rows={2}
      data-testid="cfg-help"
    />
    <p class="hint">{t('form_cfg_help_scope')}</p>
  </div>

  {#if !cfg.computed}
    <div class="switch">
      <Switch
        id="cfg-required"
        checked={cfg.required || cfg.requiredByProperty}
        disabled={cfg.requiredByProperty || cfg.requiredExpr !== undefined}
        onCheckedChange={(on: boolean) => onrequired(on)}
        data-testid="cfg-required"
      />
      <Label for="cfg-required">{t('form_cfg_required')}</Label>
    </div>
    {#if cfg.requiredByProperty}
      <p class="hint">{t('form_cfg_required_prop')}</p>
    {:else if cfg.requiredExpr !== undefined}
      <p class="hint">{t('form_cfg_required_expr', { expr: cfg.requiredExpr })}</p>
    {/if}

    <div class="row">
      <Label for="cfg-prefill">{t('form_cfg_prefill')}</Label>
      <select
        id="cfg-prefill"
        class="native"
        value={kind}
        onchange={(e) => changeKind(e.currentTarget.value as PrefillKind)}
        data-testid="cfg-prefill"
      >
        {#each PREFILL_KINDS as k (k)}
          <option value={k}>{kindLabel(k)}</option>
        {/each}
      </select>
      {#if kind === 'constant'}
        <Input
          bind:value={constant}
          onblur={() => emit('constant')}
          placeholder={t('form_cfg_prefill_constant_value')}
          aria-label={t('form_cfg_prefill_constant_value')}
          data-testid="cfg-prefill-constant"
        />
      {:else if kind === 'computed'}
        <Input
          bind:value={expression}
          onblur={() => emit('computed')}
          placeholder={t('form_cfg_prefill_expression')}
          aria-label={t('form_cfg_prefill_expression')}
          data-testid="cfg-prefill-expression"
        />
        <p class="hint">{t('form_cfg_prefill_expression_hint')}</p>
      {/if}
    </div>

    {#if now !== undefined}
      <div class="switch">
        <Switch
          id="cfg-now"
          checked={cfg.calculate === now}
          onCheckedChange={(on: boolean) =>
            onprefill(on ? { kind: 'computed', text: now } : { kind: 'empty', text: '' })}
          data-testid="cfg-now"
        />
        <Label for="cfg-now">{t('form_cfg_prefill_now')}</Label>
      </div>
    {/if}

    {#if kind !== 'empty'}
      <div class="switch">
        <Switch
          id="cfg-change"
          checked={rules?.change === true}
          disabled={rules === undefined || cfg.calculate === undefined}
          onCheckedChange={(on: boolean) => onrules({ change: on ? true : undefined })}
          data-testid="cfg-change"
        />
        <Label for="cfg-change">{t('form_cfg_force_dirty')}</Label>
      </div>
      <p class="hint">{t('form_cfg_force_dirty_hint')}</p>
    {/if}
  {/if}
</section>

<style>
  .level {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }
  .title {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--foreground);
  }
  .hint {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .hint.up {
    margin-top: -0.625rem;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .row :global(label) {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2rem;
  }
  .switch :global(label) {
    font-size: 0.8125rem;
    color: var(--foreground);
  }
  .native {
    width: 100%;
    height: 2.25rem;
    padding: 0 0.75rem;
    font-size: 0.8125rem;
    color: var(--foreground);
    cursor: pointer;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color-scheme: light dark;
  }
  .native:hover,
  .native:focus-visible {
    border-color: var(--primary);
    outline: none;
  }
  .native:focus-visible {
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--primary) 20%, transparent);
  }
</style>
