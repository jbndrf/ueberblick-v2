<script lang="ts">
  import type { TextFieldProps } from '../contract';
  import { TARGET_SIZE } from '../tokens';
  import { m } from '../paraglide/messages.js';

  let {
    id,
    label,
    value = $bindable(''),
    type = 'text',
    hint,
    error,
    required = false,
    disabled = false,
  }: TextFieldProps = $props();

  const hintId = $derived(`${id}-hint`);
  const errorId = $derived(`${id}-error`);
  const describedBy = $derived(
    [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined,
  );
</script>

<div class="ub-field">
  <label for={id}>
    {label}
    {#if required}<span class="req">({m.ui_required()})</span>{/if}
  </label>
  {#if hint}<p class="hint" id={hintId}>{hint}</p>{/if}
  {#if error}<p class="error" id={errorId}>{error}</p>{/if}
  <input
    {id}
    {type}
    {required}
    {disabled}
    bind:value
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={describedBy}
    style:min-height="{TARGET_SIZE.primary}px"
  />
</div>

<style>
  .ub-field {
    display: flex;
    flex-direction: column;
    gap: var(--ub-space-xs);
    font: var(--ub-type-weight-normal) var(--ub-type-size-md) / var(--ub-type-line-height)
      var(--ub-type-family);
    color: var(--ub-color-text);
  }
  label {
    font-weight: var(--ub-type-weight-strong);
  }
  .req,
  .hint {
    color: var(--ub-color-text-muted);
    font-weight: var(--ub-type-weight-normal);
  }
  .hint,
  .error {
    margin: 0;
    font-size: var(--ub-type-size-sm);
  }
  .error {
    color: var(--ub-color-danger);
    font-weight: var(--ub-type-weight-strong);
  }
  input {
    box-sizing: border-box;
    padding: 0 var(--ub-space-md);
    font: inherit;
    color: var(--ub-color-text);
    background: var(--ub-color-bg);
    border: 2px solid var(--ub-color-border);
    border-radius: var(--ub-radius-md);
  }
  input[aria-invalid='true'] {
    border-color: var(--ub-color-danger);
  }
  input:focus-visible {
    outline: 3px solid var(--ub-color-focus);
    outline-offset: 2px;
  }
</style>
