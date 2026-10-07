<script lang="ts">
  import type { ErrorSummaryProps } from '../contract';
  import { m } from '../paraglide/messages.js';
  import { TARGET_SIZE } from '../tokens';

  let { errors }: ErrorSummaryProps = $props();

  let root: HTMLElement | undefined = $state();
  const has = $derived(errors.length > 0);

  // Focus moves to the summary each time errors appear (GOV.UK/KERN pattern), so screen readers read it.
  $effect(() => {
    if (has) root?.focus();
  });

  function toField(e: MouseEvent, fieldId: string) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    e.preventDefault();
    field.focus();
  }
</script>

{#if has}
  <div bind:this={root} class="ub-error-summary" role="alert" tabindex="-1">
    <h2>{m.ui_error_summary_title()}</h2>
    <ul>
      {#each errors as err (err.fieldId + err.message)}
        <li>
          <a
            href={`#${err.fieldId}`}
            style:min-height="{TARGET_SIZE.other}px"
            style:line-height="{TARGET_SIZE.other}px"
            onclick={(e) => toField(e, err.fieldId)}>{err.message}</a
          >
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .ub-error-summary {
    padding: var(--ub-space-md);
    border: 3px solid var(--ub-color-danger);
    border-radius: var(--ub-radius-md);
    background: var(--ub-color-bg);
    color: var(--ub-color-text);
    /* the app's own font (the page's), not the kit's system stack */
    font-family: inherit;
    font-weight: var(--ub-type-weight-normal);
    font-size: var(--ub-type-size-md);
    line-height: var(--ub-type-line-height);
  }
  .ub-error-summary:focus-visible {
    outline: 3px solid var(--ub-color-focus);
    outline-offset: 2px;
  }
  h2 {
    margin: 0 0 var(--ub-space-sm);
    font-size: var(--ub-type-size-lg);
    color: var(--ub-color-danger);
  }
  ul {
    margin: 0;
    padding-left: var(--ub-space-lg);
  }
  a {
    color: var(--ub-color-danger);
    font-weight: var(--ub-type-weight-strong);
    display: inline-block;
  }
</style>
