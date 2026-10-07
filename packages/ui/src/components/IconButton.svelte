<script lang="ts">
  import type { IconButtonProps } from '../contract';
  import { TARGET_SIZE } from '../tokens';
  import Icon from './Icon.svelte';

  let { icon, label, disabled = false, onclick }: IconButtonProps = $props();
</script>

<button
  type="button"
  class="ub-icon-button"
  aria-label={label}
  title={label}
  style:min-height="{TARGET_SIZE.other}px"
  style:min-width="{TARGET_SIZE.other}px"
  disabled={disabled || undefined}
  {onclick}
>
  <Icon {icon} />
</button>

<style>
  .ub-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--ub-color-text);
    border: 2px solid transparent;
    border-radius: var(--ub-radius-md);
    cursor: pointer;
  }
  .ub-icon-button:focus-visible {
    outline: 3px solid var(--ub-color-focus);
    outline-offset: 2px;
  }
  .ub-icon-button:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
</style>
