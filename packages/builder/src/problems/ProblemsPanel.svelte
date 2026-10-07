<script lang="ts">
  import { Button, Icon, iconAlertTriangle, iconCheckCircle, TARGET_SIZE } from '@ueberblick/ui';
  import type { Translate } from '../shell/messages';
  import type { ProblemItem } from './model';

  interface Props {
    items: readonly ProblemItem[];
    t: Translate;
    /** Activating a problem: the shell goes to its path and focuses it. */
    onselect: (item: ProblemItem) => void;
  }
  let { items, t, onselect }: Props = $props();

  // The panel is always on screen. Folding it out is in-place disclosure, not navigation.
  let expanded = $state(true);
</script>

<aside id="ub-problems" class="panel" aria-labelledby="ub-problems-title" tabindex="-1">
  <header>
    <h2 id="ub-problems-title">
      <Icon icon={items.length === 0 ? iconCheckCircle : iconAlertTriangle} size={20} />
      {t('problems')}
      <span class="count" data-testid="problem-count">{items.length}</span>
    </h2>
    <Button variant="secondary" onclick={() => (expanded = !expanded)}>
      {expanded ? t('problems_close') : t('problems_open')}
    </Button>
  </header>
  {#if expanded}
    {#if items.length === 0}
      <p class="none" role="status">{t('problems_none')}</p>
    {:else}
      <ul>
        {#each items as item (item.id)}
          <li>
            <button
              type="button"
              class="problem"
              style:min-height="{TARGET_SIZE.other}px"
              aria-label={t('problems_go', { path: item.path }) + ': ' + item.message}
              onclick={() => onselect(item)}
            >
              <span class="msg">{item.message}</span>
              <code class="path">{item.path}</code>
              {#if item.hint}<span class="hint">{t('hint')}: {item.hint}</span>{/if}
              <span class="code">{item.code}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</aside>

<style>
  .panel {
    background: var(--ub-color-surface, var(--ub-color-bg));
    border: 2px solid var(--ub-color-border, currentColor);
    border-radius: var(--ub-radius-md);
    padding: var(--ub-space-md);
    color: var(--ub-color-text);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ub-space-md);
    flex-wrap: wrap;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: var(--ub-space-sm);
    margin: 0;
    font: var(--ub-type-weight-strong) var(--ub-type-size-lg) / var(--ub-type-line-height)
      var(--ub-type-family);
  }
  .count {
    padding: 0 var(--ub-space-sm);
    border: 2px solid currentColor;
    border-radius: var(--ub-radius-pill);
    font-size: var(--ub-type-size-sm);
  }
  ul {
    list-style: none;
    margin: var(--ub-space-md) 0 0;
    padding: 0;
    display: grid;
    gap: var(--ub-space-sm);
  }
  .problem {
    display: grid;
    gap: var(--ub-space-xs);
    width: 100%;
    text-align: start;
    padding: var(--ub-space-sm) var(--ub-space-md);
    background: transparent;
    color: inherit;
    border: 2px solid var(--ub-color-border, currentColor);
    border-radius: var(--ub-radius-md);
    font: var(--ub-type-size-md) / var(--ub-type-line-height) var(--ub-type-family);
    cursor: pointer;
  }
  .problem:focus-visible,
  .panel:focus-visible {
    outline: 3px solid var(--ub-color-focus);
    outline-offset: 2px;
  }
  .msg {
    font-weight: var(--ub-type-weight-strong);
  }
  .path,
  .code {
    font-size: var(--ub-type-size-sm);
    overflow-wrap: anywhere;
  }
  .hint {
    font-size: var(--ub-type-size-sm);
  }
  .none {
    margin: var(--ub-space-md) 0 0;
  }
</style>
