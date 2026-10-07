<script lang="ts">
  // Faults in the config that the app cannot fix and did not hide: an unresolved layer style, a bad tool setting, a
  // map that would not load. Each says its code and what it is about. It adds no navigation (docs/13 principle 8).
  import { problemText, type AppProblem } from './notices';
  import type { Locale } from './messages';

  interface Props {
    problems: readonly AppProblem[];
    locale: Locale;
  }
  let { problems, locale }: Props = $props();
</script>

<!-- The live region is a wrapper that stays in the page: `role="status"` on the `ul` would replace its list role.
     Status reads its whole content by default; `aria-atomic="false"` with additions only reads a new notice, once. -->
<div role="status" aria-atomic="false" aria-relevant="additions" data-testid="problems">
  {#if problems.length > 0}
    <ul class="problems">
      {#each problems as p (`${p.code}:${p.subject}`)}
        <li data-problem={p.code}>{problemText(locale, p)}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .problems {
    margin: 0;
    padding: var(--ub-space-sm) var(--ub-space-md);
    list-style: none;
    background: var(--ub-color-status-refused-bg);
    color: var(--ub-color-status-refused-fg);
    border-bottom: 2px solid currentColor;
  }
  li {
    padding: 2px 0;
  }
</style>
