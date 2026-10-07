<script lang="ts">
  // v3 `FieldConfigPanel.svelte:714-766` (text: min and max length, `:741-746` the regex pattern), `:781-786`
  // (number: step) and `:921-949` (multiple choice: selection limits): inputs in a grid, committed on blur. Here they
  // write the form entry's `constraint` (`constraint.ts`), so they belong to this form: the pattern is `matches`
  // (WP-428), the step `multiple_of(value, step)` (WP-457), exact for decimals too (whole numbers only on an integer field).
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import type { MessageKey, Translate } from '../../shell/messages';
  import type { FieldConfig } from './config';
  import { isValidStep, patternProblem, type RulesPatch } from './constraint';

  interface Props {
    t: Translate;
    cfg: FieldConfig;
    onrules: (patch: RulesPatch) => void;
  }
  let { t, cfg, onrules }: Props = $props();

  const choices = $derived(cfg.property?.type === 'multiselect');
  const kind = $derived(cfg.property?.type);
  const isText = $derived(kind === 'text');
  const isInteger = $derived(kind === 'integer');
  const applies = $derived(
    kind === 'text' ||
      kind === 'localized_text' ||
      kind === 'multiselect' ||
      kind === 'integer' ||
      kind === 'number',
  );
  const lengths = $derived(kind === 'text' || kind === 'localized_text' || kind === 'multiselect');
  const rules = $derived(cfg.constraint.foreign ? undefined : cfg.constraint.rules);

  let min = $state('');
  let max = $state('');
  let pattern = $state('');
  let step = $state('');
  let patternError = $state('');
  let stepError = $state(false);
  $effect(() => {
    min = rules?.minLength === undefined ? '' : String(rules.minLength);
    max = rules?.maxLength === undefined ? '' : String(rules.maxLength);
    pattern = rules?.pattern ?? '';
    step = rules?.step === undefined ? '' : String(rules.step);
    patternError = '';
    stepError = false;
  });

  /** The compile problem of a pattern in the builder's words (`expr_matches_*`, the same as in the Code view). */
  function problemText(pattern: string): string {
    const p = patternProblem(pattern);
    if (p === undefined) return '';
    const word = (prefix: string, key: unknown): string =>
      t(`${prefix}${String(key)}` as MessageKey, p.params);
    const params =
      p.code === 'matches_pattern_syntax'
        ? { ...p.params, detail: word('expr_matches_syntax_', p.params['detail']) }
        : p.code === 'matches_pattern_unsupported'
          ? { ...p.params, feature: word('expr_matches_unsupported_', p.params['feature']) }
          : p.params;
    return t(`expr_${p.code}` as MessageKey, params);
  }

  const number = (value: unknown): number | undefined => {
    const text = String(value ?? '');
    const n = Number(text);
    return text.trim() === '' || !Number.isInteger(n) || n < 0 ? undefined : n;
  };
  const commit = (): void => {
    const next = { minLength: number(min), maxLength: number(max) };
    if (next.minLength !== rules?.minLength || next.maxLength !== rules?.maxLength) onrules(next);
  };
  const commitPattern = (): void => {
    const next = pattern === '' ? undefined : pattern;
    patternError = next === undefined ? '' : problemText(next);
    if (patternError === '' && next !== rules?.pattern) onrules({ pattern: next });
  };
  const commitStep = (): void => {
    const text = String(step ?? '');
    const next = text.trim() === '' ? undefined : Number(text);
    stepError = next !== undefined && !(isValidStep(next) && (!isInteger || Number.isInteger(next)));
    if (!stepError && next !== rules?.step) onrules({ step: next });
  };
</script>

{#if applies}
  <section class="block" data-testid="cfg-validation">
    <Label>{choices ? t('form_cfg_selection_limits') : t('form_cfg_validation')}</Label>
    {#if cfg.constraint.foreign}
      <p class="hint" data-testid="cfg-foreign">{t('form_cfg_foreign')}</p>
    {:else}
      {#if lengths}
        <div class="grid">
          <div class="cell">
            <Label for="cfg-min">{choices ? t('form_cfg_min_selections') : t('form_cfg_min_length')}</Label>
            <Input
              id="cfg-min"
              type="number"
              min={0}
              bind:value={min}
              onblur={commit}
              placeholder={'0'}
              data-testid="cfg-min"
            />
          </div>
          <div class="cell">
            <Label for="cfg-max">{choices ? t('form_cfg_max_selections') : t('form_cfg_max_length')}</Label>
            <Input
              id="cfg-max"
              type="number"
              min={choices ? 1 : 0}
              bind:value={max}
              onblur={commit}
              placeholder={t('form_cfg_no_limit')}
              data-testid="cfg-max"
            />
          </div>
        </div>
      {/if}
      {#if isText}
        <div class="cell">
          <Label for="cfg-pattern">{t('form_cfg_pattern')}</Label>
          <Input
            id="cfg-pattern"
            bind:value={pattern}
            onblur={commitPattern}
            placeholder={t('form_cfg_pattern_placeholder')}
            aria-invalid={patternError !== ''}
            aria-describedby={patternError === '' ? undefined : 'cfg-pattern-error'}
            data-testid="cfg-pattern"
          />
          {#if patternError !== ''}
            <p class="error" id="cfg-pattern-error" role="alert" data-testid="cfg-pattern-error">
              {patternError}
            </p>
          {/if}
        </div>
      {:else if isInteger || kind === 'number'}
        <div class="grid">
          <div class="cell">
            <Label for="cfg-step">{t('form_cfg_step')}</Label>
            <Input
              id="cfg-step"
              type="number"
              min={isInteger ? 1 : undefined}
              step={isInteger ? 1 : 'any'}
              bind:value={step}
              onblur={commitStep}
              placeholder={isInteger ? '1' : '0.5'}
              aria-invalid={stepError}
              aria-describedby={stepError ? 'cfg-step-error' : undefined}
              data-testid="cfg-step"
            />
            {#if stepError}
              <p class="error" id="cfg-step-error" role="alert" data-testid="cfg-step-error">
                {t(isInteger ? 'form_cfg_step_error' : 'form_cfg_step_error_decimal')}
              </p>
            {/if}
          </div>
        </div>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .block > :global(label) {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .cell :global(label) {
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .cell :global(input) {
    height: 2rem;
  }
  .error {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--destructive);
  }
  .hint {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
</style>
