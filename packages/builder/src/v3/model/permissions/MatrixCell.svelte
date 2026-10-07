<script lang="ts">
  // v3 `MatrixCell.svelte`: one role's access in one row, an icon in a small box that toggles it. Green when
  // allowed, a dashed border when the permission is "all roles" (so it follows new roles), red and dim when denied.
  // New in v4: a locked cell (the file keeps that audience elsewhere), and the provenance mark with its reset
  // (the draft changed this cell against the template; the mark is the reset).
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import FileMinus from '@lucide/svelte/icons/file-minus';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import PencilOff from '@lucide/svelte/icons/pencil-off';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import type { PermAction } from '@ueberblick/core';

  interface Props {
    allowed: boolean;
    isAll: boolean;
    action: PermAction;
    /** Names the checkbox: role, row and action. */
    label: string;
    /** Why a locked cell cannot be toggled; set = locked. */
    lockedReason?: string | undefined;
    modified?: boolean;
    resetLabel?: string;
    ontoggle?: () => void;
    onreset?: () => void;
  }
  let {
    allowed,
    isAll,
    action,
    label,
    lockedReason,
    modified = false,
    resetLabel = '',
    ontoggle,
    onreset,
  }: Props = $props();
</script>

{#snippet icon()}
  {#if action === 'see'}
    {#if allowed}<Eye />{:else}<EyeOff />{/if}
  {:else if action === 'create'}
    {#if allowed}<FilePlus />{:else}<FileMinus />{/if}
  {:else if action === 'delete'}
    <Trash2 />
  {:else if allowed}<Pencil />{:else}<PencilOff />{/if}
{/snippet}

<span class="cell">
  {#if lockedReason !== undefined}
    <span
      class="box locked"
      class:allowed
      role="checkbox"
      aria-checked={allowed}
      aria-disabled="true"
      aria-label={label}
      title={lockedReason}
    >
      {@render icon()}
    </span>
  {:else}
    <button
      type="button"
      class="box"
      class:allowed
      class:all={allowed && isAll}
      role="checkbox"
      aria-checked={allowed}
      aria-label={label}
      title={label}
      onclick={ontoggle}
    >
      {@render icon()}
    </button>
  {/if}
  {#if modified}
    <button
      type="button"
      class="reset"
      aria-label={resetLabel}
      title={resetLabel}
      data-testid="matrix-reset"
      onclick={onreset}
    >
      <RotateCcw />
    </button>
  {/if}
</span>

<style>
  .cell {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
  }
  .box {
    display: inline-flex;
    height: 2.25rem;
    width: 2.25rem;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    background: transparent;
    color: color-mix(in oklab, var(--destructive) 40%, transparent);
    cursor: pointer;
    transition: transform 0.12s;
  }
  .box :global(svg) {
    height: 1rem;
    width: 1rem;
  }
  .box.allowed {
    color: var(--matrix-allowed, #16a34a);
  }
  .box.all {
    border-style: dashed;
    border-color: color-mix(in oklab, var(--matrix-allowed, #16a34a) 40%, transparent);
  }
  button.box:hover {
    background: var(--accent);
    transform: scale(1.1);
  }
  button.box:focus-visible,
  .reset:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }
  .box.locked {
    cursor: default;
    opacity: 0.8;
  }
  .reset {
    display: inline-flex;
    height: 1.25rem;
    width: 1.25rem;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: transparent;
    color: var(--primary);
    cursor: pointer;
  }
  .reset :global(svg) {
    height: 0.75rem;
    width: 0.75rem;
  }
  .reset:hover {
    background: var(--accent);
  }
  @media (min-width: 768px) {
    .box {
      height: 1.75rem;
      width: 1.75rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .box {
      transition: none;
    }
    button.box:hover {
      transform: none;
    }
  }
</style>
