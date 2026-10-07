<script lang="ts">
  // v3 `FormPreview.svelte` page tabs (lines 760-840): a tab per page; the open one has a pencil (rename the
  // title in place) and an X (take the page out; its fields join the page before, v3 left them alone). "+" adds
  // a page. A page of the file exists with its first field, so a page added here is pending until a field joins
  // it (v3 kept such empty pages in the editor's own state too). A card dropped on a tab moves to that page.
  import Check from '@lucide/svelte/icons/check';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import type { Translate } from '../../shell/messages';
  import type { Drag } from './drag.svelte';

  interface Props {
    t: Translate;
    /** Title of each page (the page's own, or "Seite n"); one more at the end while a page is pending. */
    titles: readonly string[];
    /** The pages that have a title of their own, for the rename field. */
    current: number;
    drag: Drag;
    /** A page was added and has no field yet: it is the last tab. */
    pending: boolean;
    onselect: (page: number) => void;
    onadd: () => void;
    onremove: (page: number) => void;
    onrename: (page: number, text: string) => void;
  }
  let { t, titles, current, drag, pending, onselect, onadd, onremove, onrename }: Props = $props();

  let editing: number | undefined = $state();
  let draft = $state('');

  function startEditing(page: number): void {
    editing = page;
    draft = titles[page] ?? '';
  }

  function save(): void {
    if (editing === undefined) return;
    const page = editing;
    editing = undefined;
    const text = draft.trim();
    if (text !== '' && text !== titles[page]) onrename(page, text);
  }

  const dropOn = (page: number): string => JSON.stringify({ kind: 'page', page });
  const over = (page: number): boolean => drag.over?.kind === 'page' && drag.over.page === page;
</script>

<div class="page-tabs" data-testid="page-tabs">
  <div class="tabs" role="tablist" aria-label={t('form_pages')}>
    {#each titles as title, page (page)}
      {@const active = current === page}
      <div
        class="tab"
        class:active
        class:drop-target={drag.active?.kind === 'card' && !active}
        class:over={over(page)}
        data-dest={dropOn(page)}
        data-testid={`page-tab-${page}`}
      >
        {#if editing === page}
          <Input
            bind:value={draft}
            class="title-input"
            aria-label={t('form_page_rename')}
            data-testid="page-title-input"
            onblur={save}
            onkeydown={(e) => {
              // preventDefault: the input goes away at once and the Enter must not activate what gets the focus next
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                editing = undefined;
              }
            }}
            autofocus
          />
          <button
            type="button"
            class="mini on"
            aria-label={t('form_page_save')}
            onmousedown={(e) => e.preventDefault()}
            onclick={save}
          >
            <Check size={12} />
          </button>
        {:else}
          <button
            type="button"
            role="tab"
            class="tab-title"
            aria-selected={active}
            data-testid={`page-select-${page}`}
            onclick={() => onselect(page)}>{title}</button
          >
          {#if active}
            {#if !(pending && page === titles.length - 1)}
              <button
                type="button"
                class="mini"
                aria-label={t('form_page_rename')}
                data-testid="page-rename"
                onclick={() => startEditing(page)}><Pencil size={12} /></button
              >
            {/if}
            {#if titles.length > 1}
              <button
                type="button"
                class="mini del"
                aria-label={t('form_page_delete', { title })}
                data-testid="page-delete"
                onclick={() => onremove(page)}><X size={12} /></button
              >
            {/if}
          {/if}
        {/if}
      </div>
    {/each}
  </div>
  <Button
    variant="ghost"
    size="sm"
    class="add-page"
    aria-label={t('form_page_add')}
    title={t('form_page_add')}
    data-testid="page-add"
    disabled={pending}
    onclick={onadd}
  >
    <Plus class="h-4 w-4" />
  </Button>
</div>

<style>
  .page-tabs {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem;
    flex-shrink: 0;
    background: color-mix(in oklab, var(--muted) 30%, transparent);
    border-bottom: 1px solid var(--border);
    border-radius: 0.5rem 0.5rem 0 0;
  }
  .tabs {
    display: flex;
    flex: 1;
    gap: 0.25rem;
    overflow-x: auto;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0.125rem 0.25rem 0.125rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
    white-space: nowrap;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    transition: all 0.15s ease;
  }
  .tab:hover {
    color: var(--foreground);
    background: var(--background);
  }
  .tab.active {
    color: var(--foreground);
    background: var(--background);
    border-color: var(--border);
    box-shadow: 0 1px 2px color-mix(in oklab, var(--foreground) 5%, transparent);
  }
  .tab.drop-target {
    outline: 2px dashed var(--primary);
    outline-offset: -2px;
  }
  .tab.over {
    background: color-mix(in oklab, var(--primary) 15%, transparent);
  }
  .tab-title {
    min-height: 2rem;
    max-width: 8rem;
    padding: 0 0.25rem;
    overflow: hidden;
    font: inherit;
    color: inherit;
    text-overflow: ellipsis;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .tab :global(.title-input) {
    width: 6rem;
    height: 1.5rem;
    padding: 0 0.25rem;
    font-size: 0.75rem;
  }
  .mini {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    color: var(--muted-foreground);
    background: transparent;
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
  }
  .mini:hover {
    color: var(--primary);
    background: var(--accent);
  }
  .mini.del:hover {
    color: var(--destructive);
    background: color-mix(in oklab, var(--destructive) 10%, transparent);
  }
  .page-tabs :global(.add-page) {
    width: 2rem;
    height: 2rem;
    padding: 0;
    flex-shrink: 0;
  }
  @media (max-width: 767px), (pointer: coarse) {
    .mini {
      width: 2rem;
      height: 2rem;
    }
    .tab-title {
      min-height: 2.5rem;
    }
    .page-tabs :global(.add-page) {
      width: 2.5rem;
      height: 2.5rem;
    }
  }
</style>
