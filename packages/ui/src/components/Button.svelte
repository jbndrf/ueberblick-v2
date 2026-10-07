<script lang="ts">
  import type { ButtonProps } from '../contract';
  import { TARGET_SIZE } from '../tokens';
  import { m } from '../paraglide/messages.js';
  import Icon from './Icon.svelte';
  import { iconSpinner } from '../icons';

  let {
    variant = 'primary',
    loading = false,
    disabled = false,
    type = 'button',
    onclick,
    children,
  }: ButtonProps = $props();

  // Primary and danger are the actions of a screen: 56 px. Secondary is 44 px (docs/13 principle 9).
  const target = $derived(variant === 'secondary' ? TARGET_SIZE.other : TARGET_SIZE.primary);
  const inert = $derived(loading || disabled);

  function handle(e: MouseEvent) {
    if (inert) {
      e.preventDefault();
      return;
    }
    onclick?.(e);
  }
</script>

<button
  {type}
  class="ub-button"
  data-variant={variant}
  style:min-height="{target}px"
  style:min-width="{target}px"
  disabled={disabled || undefined}
  aria-disabled={loading ? 'true' : undefined}
  aria-busy={loading ? 'true' : undefined}
  onclick={handle}
>
  {#if loading}
    <span class="spin"><Icon icon={iconSpinner} size={20} /></span>
    <span class="sr-only">{m.ui_loading()}</span>
  {/if}
  {@render children()}
</button>

<style>
  .ub-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--ub-space-sm);
    padding: 0 var(--ub-space-lg);
    border: 2px solid transparent;
    border-radius: var(--ub-radius-md);
    font: var(--ub-type-weight-strong) var(--ub-type-size-md) / var(--ub-type-line-height)
      var(--ub-type-family);
    cursor: pointer;
  }
  .ub-button[data-variant='primary'] {
    background: var(--ub-color-primary);
    color: var(--ub-color-on-primary);
  }
  .ub-button[data-variant='danger'] {
    background: var(--ub-color-danger);
    color: var(--ub-color-on-danger);
  }
  .ub-button[data-variant='secondary'] {
    background: var(--ub-color-bg);
    color: var(--ub-color-primary);
    border-color: var(--ub-color-primary);
  }
  .ub-button:focus-visible {
    outline: 3px solid var(--ub-color-focus);
    outline-offset: 2px;
  }
  .ub-button:disabled,
  .ub-button[aria-disabled='true'] {
    opacity: 0.7;
    cursor: not-allowed;
  }
  .spin {
    display: inline-flex;
    animation: ub-spin 1s linear infinite;
  }
  @keyframes ub-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
