<script lang="ts">
  // v3 `form-editor/FormPreview.svelte`: the form as the participant sees it, in a 375 px frame: page tabs, the page
  // description, then the lines of the page, each line one full-width card or two half-width ones. While something is
  // dragged the drop zones appear: before each line, after the last one, left | full | right (v3 `dropZoneRow`), the
  // empty side of a half-width line (`emptySideZone`), and beside a single full-width card ("squeeze"). The cards are
  // `FieldCard`; the participant's `FieldInput` draws them. v3's drop zones for "new field" and "move" were two sets
  // with two colours; one set serves both here, its text says which it is.
  import { flip } from 'svelte/animate';
  import AlignLeft from '@lucide/svelte/icons/align-left';
  import AlignRight from '@lucide/svelte/icons/align-right';
  import Maximize2 from '@lucide/svelte/icons/maximize-2';
  import Plus from '@lucide/svelte/icons/plus';
  import { Textarea } from '@ueberblick/ui/components/ui/textarea';
  import type { Translate } from '../../shell/messages';
  import type { Drag } from './drag.svelte';
  import type { Actions } from './actions';
  import FieldCard from './FieldCard.svelte';
  import { keysOf, type Column, type Dest, type Line } from './layout';
  import type { EditorModel } from './model';
  import PageTabs from './PageTabs.svelte';
  import { pageText } from './ops';

  interface Props {
    t: Translate;
    locale: string;
    model: EditorModel;
    /** The open page; one past the last is the pending page. */
    page: number;
    pending: boolean;
    selected: string | undefined;
    stageKey: string | undefined;
    drag: Drag;
    actions: Actions;
  }
  let { t, locale, model, page, pending, selected, stageKey, drag, actions }: Props = $props();

  const pages = $derived(model.layout.pages);
  const keys = $derived(keysOf(model.layout));
  const lines = $derived<readonly Line[]>(pages[page]?.lines ?? []);
  const titles = $derived([
    ...pages.map((p, i) => pageText(p.meta, 'label', locale) || t('form_page_fallback', { page: i + 1 })),
    ...(pending ? [t('form_page_fallback', { page: pages.length + 1 })] : []),
  ]);
  const hint = $derived(pageText(pages[page]?.meta, 'hint', locale));
  let draft = $state('');
  $effect(() => {
    draft = hint;
  });

  const dragging = $derived(drag.active !== undefined);
  const moving = $derived(drag.active?.kind === 'card');
  const dropText = $derived(moving ? t('form_drop_move') : t('form_drop_new'));
  const key = (d: Dest): string => JSON.stringify(d);
  const isOver = (d: Dest): boolean => drag.over !== undefined && key(drag.over) === key(d);
  const ZONES = [
    { column: 'left', icon: AlignLeft, label: () => t('form_drop_left') },
    { column: 'full', icon: Maximize2, label: () => t('form_drop_full') },
    { column: 'right', icon: AlignRight, label: () => t('form_drop_right') },
  ] as const;
  const other = (c: Column): 'left' | 'right' => (c === 'left' ? 'right' : 'left');
  /** Where the drop would go beside the single card `key` ("squeeze"); the card takes the other half. */
  const squeezeAt = (key: string): 'left' | 'right' | undefined =>
    drag.over?.kind === 'beside' && drag.over.key === key ? drag.over.column : undefined;
</script>

{#snippet zones(at: number, small: boolean)}
  <div
    class="insert"
    class:small
    class:expanded={drag.over?.kind === 'line' && drag.over.page === page && drag.over.line === at}
  >
    {#each ZONES as z (z.column)}
      {@const dest = { kind: 'line', page, line: at, column: z.column } satisfies Dest}
      {@const Icon = z.icon}
      <div
        class="zone"
        class:active={isOver(dest)}
        data-dest={key(dest)}
        data-testid={`zone-${at}-${z.column}`}
        role="presentation"
        title={z.label()}
      >
        {#if isOver(dest)}<span class="placeholder" class:wide={z.column === 'full'}>{dropText}</span
          >{:else}<Icon size={small ? 14 : 20} />{/if}
      </div>
    {/each}
  </div>
{/snippet}

<div class="frame" data-testid="form-preview" role="region" aria-label={t('form_preview')} class:dragging>
  <PageTabs
    {t}
    {titles}
    current={page}
    {drag}
    {pending}
    onselect={actions.openPage}
    onadd={actions.addPage}
    onremove={actions.deletePage}
    onrename={(i, text) => actions.pageText(i, 'label', text)}
  />

  {#if keys.length > 0 && !(pending && page >= pages.length)}
    <div class="description">
      <Textarea
        bind:value={draft}
        class="description-input"
        rows={2}
        aria-label={t('form_page_description_placeholder')}
        placeholder={t('form_page_description_placeholder')}
        data-testid="page-description"
        onblur={() => draft.trim() !== hint.trim() && actions.pageText(page, 'hint', draft.trim())}
      />
    </div>
  {/if}

  <div class="inner">
    {#if lines.length === 0}
      {#if dragging}
        {@render zones(0, false)}
      {:else}
        <div class="empty" data-testid="form-empty">
          <div class="empty-icon"><Plus size={32} /></div>
          <p class="empty-title">{t('form_empty_title')}</p>
          <p class="empty-desc">
            {pending && keys.length > 0 ? t('form_page_empty_hint') : t('form_empty_hint')}
          </p>
        </div>
      {/if}
    {:else}
      <div class="lines">
        {#each lines as line, at (line[0]?.key)}
          {@const single = line.length === 1 ? line[0] : undefined}
          {@const squeezeColumn = single === undefined ? undefined : squeezeAt(single.key)}
          {@const squeezed = squeezeColumn !== undefined}
          <!-- v3 `animate:flip` (200 ms): a line that moves slides to its place -->
          <div class="entry" animate:flip={{ duration: 200 }}>
            {#if dragging}{@render zones(at, true)}{/if}
            <div
              class="line"
              class:squeezed
              data-testid="form-line"
              data-squeeze={single !== undefined &&
              single.column === 'full' &&
              !(drag.active?.kind === 'card' && drag.active.key === single.key)
                ? single.key
                : undefined}
            >
              {#if squeezeColumn === 'left'}
                <div class="cell half preview-cell"><div class="placeholder">{dropText}</div></div>
              {/if}
              {#each line as cell (cell.key)}
                {@const view = model.fields.get(cell.key)}
                {@const asHalf = line.length > 1 || cell.column !== 'full' || squeezed}
                <div
                  class="cell"
                  animate:flip={{ duration: 200 }}
                  class:half={asHalf}
                  data-column={squeezeColumn === undefined ? cell.column : other(squeezeColumn)}
                >
                  {#if view !== undefined}
                    <FieldCard
                      {t}
                      {locale}
                      {view}
                      column={cell.column}
                      selected={selected === cell.key}
                      dragging={drag.active?.kind === 'card' && drag.active.key === cell.key}
                      half={asHalf}
                      protectedKey={cell.key === stageKey || cell.key.includes('.')}
                      {drag}
                      onselect={() => actions.select(cell.key)}
                      onrename={(text) => actions.rename(cell.key, text)}
                      onremove={() => actions.remove(cell.key)}
                      ondelete={() => actions.del(cell.key)}
                    />
                  {/if}
                </div>
              {/each}
              {#if squeezeColumn === 'right'}
                <div class="cell half preview-cell"><div class="placeholder">{dropText}</div></div>
              {/if}
              {#if single !== undefined && single.column !== 'full' && dragging && !(drag.active?.kind === 'card' && drag.active.key === single.key)}
                {@const side = { kind: 'side', page, line: at, column: other(single.column) } satisfies Dest}
                {@const SideIcon = side.column === 'left' ? AlignLeft : AlignRight}
                <div
                  class="empty-side"
                  class:active={isOver(side)}
                  class:before={side.column === 'left'}
                  data-dest={key(side)}
                  data-testid={`side-${at}`}
                  role="presentation"
                >
                  {#if isOver(side)}<span class="placeholder">{dropText}</span>{:else}<SideIcon
                      size={22}
                    />{/if}
                </div>
              {/if}
            </div>
          </div>
        {/each}
        {#if dragging}{@render zones(lines.length, false)}{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .frame {
    display: flex;
    flex-shrink: 0;
    flex-direction: column;
    width: 100%;
    max-width: 375px;
    min-height: 400px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: 0 2px 8px oklch(0 0 0 / 0.08);
  }
  .frame.dragging {
    border-style: dashed;
    border-color: var(--primary);
  }
  .description {
    padding: 0.5rem 0.75rem 0;
    flex-shrink: 0;
  }
  .description :global(.description-input) {
    font-size: 0.75rem;
    resize: vertical;
    background: color-mix(in oklab, var(--muted) 30%, transparent);
  }
  .inner {
    flex: 1;
    padding: 1rem 1rem 9rem;
  }
  @container (max-width: 499px) {
    .inner {
      padding: 0.75rem 0.75rem 9rem;
    }
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .line {
    display: flex;
    gap: 0.5rem;
    transition: all 0.2s ease;
  }
  .cell {
    flex: 1;
    min-width: 0;
    transition:
      flex 0.2s ease,
      margin 0.2s ease;
  }
  .cell.half {
    flex: 0 0 calc(50% - 0.25rem);
  }
  .cell[data-column='right'] {
    margin-left: auto;
  }
  .preview-cell .placeholder {
    height: 100%;
  }
  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 48px;
    padding: 0.5rem;
    font-size: 0.75rem;
    text-align: center;
    color: var(--muted-foreground);
    background: var(--muted);
    border: 2px dashed var(--primary);
    border-radius: 0.375rem;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 3rem 1rem;
    text-align: center;
  }
  .empty-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    margin-bottom: 1rem;
    color: var(--muted-foreground);
    background: var(--muted);
    border-radius: 50%;
  }
  .empty-title {
    margin: 0 0 0.25rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--foreground);
  }
  .empty-desc {
    margin: 0;
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }
  /* The drop zones: left | full | right. Between lines they are a thin strip that opens when it is the target. */
  .insert {
    display: flex;
    min-height: 60px;
    overflow: hidden;
    background: color-mix(in oklab, var(--muted) 10%, transparent);
    border: 3px dashed #888;
    border-radius: 0.5rem;
  }
  .insert.small {
    height: 14px;
    min-height: 0;
    margin: 0.125rem 0;
    border-width: 2px;
    border-radius: 4px;
    transition: all 0.2s ease;
  }
  .insert.small.expanded,
  .insert.small:hover {
    height: 50px;
    border-color: var(--primary);
  }
  .zone {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    color: #666;
    background: color-mix(in oklab, var(--muted) 20%, transparent);
    border-right: 2px dashed #888;
    transition: all 0.15s ease;
  }
  .zone:last-child {
    border-right: none;
  }
  .insert.small .zone :global(svg) {
    opacity: 0;
  }
  .insert.small.expanded .zone :global(svg),
  .insert.small:hover .zone :global(svg) {
    opacity: 1;
  }
  .zone:hover,
  .zone.active {
    color: var(--primary);
    background: color-mix(in oklab, var(--primary) 15%, transparent);
  }
  .zone .placeholder {
    min-height: 0;
    border: none;
    background: transparent;
  }
  .zone .placeholder.wide {
    flex: 1;
  }
  .empty-side {
    flex: 0 0 calc(50% - 0.25rem);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60px;
    padding: 0.25rem;
    color: #666;
    background: color-mix(in oklab, var(--muted) 15%, transparent);
    border: 3px dashed #888;
    border-radius: 0.375rem;
    transition: all 0.15s ease;
  }
  .empty-side.before {
    order: -1;
  }
  .empty-side.active,
  .empty-side:hover {
    color: var(--primary);
    border-color: var(--primary);
    background: color-mix(in oklab, var(--primary) 10%, transparent);
  }
</style>
