<script lang="ts">
  // The problems badge (comparison §10.20): the count of this Objektart's problems in the toolbar.
  // Clicking opens the list in place; an entry takes the admin to its entity. No separate panel.
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { ProblemItem } from '../../problems/model';
  import type { Translate } from '../../shell/messages';

  interface Props {
    items: readonly ProblemItem[];
    t: Translate;
    onselect: (item: ProblemItem) => void;
  }
  let { items, t, onselect }: Props = $props();

  let open = $state(false);
  const none = $derived(items.length === 0);

  function pick(item: ProblemItem): void {
    open = false;
    onselect(item);
  }
</script>

<div
  class="problems"
  role="presentation"
  onkeydown={(e) => {
    if (e.key === 'Escape') open = false;
  }}
>
  <button
    type="button"
    class="badge"
    class:has-problems={!none}
    aria-expanded={open}
    aria-controls="builder-problems-list"
    aria-label={t('problems_count', { n: items.length })}
    data-testid="problems-badge"
    onclick={() => (open = !open)}
  >
    {#if none}<CircleAlert class="icon" />{:else}<TriangleAlert class="icon" />{/if}
    <span data-testid="problem-count">{items.length}</span>
  </button>
  {#if open}
    <div id="builder-problems-list" class="list" role="region" aria-label={t('problems')}>
      {#if none}
        <p class="none" role="status">{t('problems_none')}</p>
      {:else}
        <ul>
          {#each items as item (item.id)}
            <li>
              <button
                type="button"
                class="entry"
                aria-label={t('problems_go', { path: item.path }) + ': ' + item.message}
                onclick={() => pick(item)}
              >
                <span class="message">{item.message}</span>
                <code class="path">{item.path}</code>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .problems {
    position: relative;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    height: 2rem;
    padding: 0 0.6rem;
    border-radius: 0.4rem;
    border: 1px solid var(--border);
    background: var(--background);
    color: var(--muted-foreground);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }
  .badge.has-problems {
    color: var(--destructive);
    border-color: color-mix(in oklab, var(--destructive) 40%, transparent);
  }
  .badge :global(.icon) {
    width: 14px;
    height: 14px;
  }
  .list {
    position: absolute;
    inset-block-start: calc(100% + 0.25rem);
    inset-inline-start: 0;
    z-index: 20;
    width: 24rem;
    max-width: 90vw;
    max-height: 60vh;
    overflow-y: auto;
    padding: 0.35rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--card);
    color: var(--card-foreground);
    box-shadow: 0 6px 20px color-mix(in oklab, var(--foreground) 15%, transparent);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    width: 100%;
    min-height: 44px;
    padding: 0.4rem 0.5rem;
    border: none;
    border-radius: 0.375rem;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .entry:hover {
    background: var(--accent);
  }
  .message {
    font-size: 0.8125rem;
  }
  .path {
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .none {
    margin: 0.4rem;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
</style>
