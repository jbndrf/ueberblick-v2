<script lang="ts">
  // v3 `FieldConfigPanel.svelte:957-1027` (Erweitert, "Vom Server berechnet"): the switch, the expression and the list
  // of the fields it reads, an unknown one in red. Here the value is the property's `computed` (owner Q29, WP-312):
  // plan keeps it up to date on the device and the server, and every computation is in the history. A valid expression
  // is written on "Übernehmen"; an invalid one is refused and the problem shows under the field.
  import type { TemplateFile } from '@ueberblick/core';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { Textarea } from '@ueberblick/ui/components/ui/textarea';
  import type { Translate } from '../../shell/messages';
  import { dependenciesOf } from './computed';

  interface Props {
    t: Translate;
    locale: string;
    file: TemplateFile;
    type: string;
    /** The property's current expression, if any. */
    source: string | undefined;
    /** The property is in a task's form: `computed` would be a problem there (`computed_written`). */
    inForm: boolean;
    /** Writes the expression (empty takes Berechnet off); returns why it was not applied. */
    apply: (source: string) => string | undefined;
  }
  let { t, locale, file, type, source, inForm, apply }: Props = $props();

  let enabling = $state(false);
  let draft = $state('');
  let error: string | undefined = $state();
  $effect(() => {
    draft = source ?? '';
    error = undefined;
  });

  const on = $derived(source !== undefined || enabling);
  const dirty = $derived(draft.trim() !== (source ?? ''));
  const deps = $derived(dependenciesOf(draft, file, type, locale));

  function toggle(next: boolean): void {
    error = undefined;
    if (next) {
      if (inForm) {
        error = t('field_computed_in_form');
        return;
      }
      enabling = true;
      return;
    }
    enabling = false;
    if (source !== undefined) error = apply('');
  }
  function submit(): void {
    error = apply(draft);
    if (error === undefined) enabling = false;
  }
</script>

<div class="block" data-testid="field-computed-block">
  <hr class="sep" />
  <h5 class="heading">{t('field_advanced')}</h5>
  <div class="switch">
    <Switch id="field-computed" checked={on} onCheckedChange={toggle} data-testid="field-computed" />
    <Label for="field-computed">{t('field_computed')}</Label>
  </div>
  <p class="hint">{t('field_computed_hint')}</p>

  {#if on}
    <div class="row">
      <Label for="field-computed-expression">{t('field_computed_expression')}</Label>
      <Textarea
        id="field-computed-expression"
        bind:value={draft}
        rows={3}
        placeholder={'round(self.hoehe_m * 2, 1)'}
        aria-invalid={error !== undefined}
        data-testid="field-computed-expression"
      />
      <p class="hint">{t('field_computed_help')}</p>
      {#if dirty}
        <Button type="button" size="sm" onclick={submit} data-testid="field-computed-apply">
          {t('field_computed_apply')}
        </Button>
      {/if}
    </div>

    <div class="deps">
      <Label>{t('field_computed_deps')}</Label>
      {#if deps.length === 0}
        <p class="empty">{t('field_computed_deps_empty')}</p>
      {:else}
        <div class="chips" data-testid="field-computed-deps">
          {#each deps as dep (dep.key)}
            <span class="chip" class:unknown={dep.label === null}>
              {dep.label ?? t('field_computed_dep_unknown')}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if error !== undefined}
    <p class="error" role="alert" data-testid="field-computed-error">{error}</p>
  {/if}
</div>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .sep {
    margin: 0.25rem 0 0;
    border: none;
    border-top: 1px solid var(--border);
  }
  .heading {
    margin: 0;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2rem;
    font-size: 0.8125rem;
  }
  .row,
  .deps {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .row :global(label),
  .deps :global(label) {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .hint {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .empty {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    line-height: 1.25rem;
    color: var(--muted-foreground);
    background: var(--muted);
    border-radius: 9999px;
  }
  .chip.unknown {
    color: var(--destructive);
    background: color-mix(in srgb, var(--destructive) 15%, transparent);
  }
  .error {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--destructive);
  }
</style>
