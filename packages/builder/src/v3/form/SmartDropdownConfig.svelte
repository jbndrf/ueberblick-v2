<script lang="ts">
  // v3 `form-editor/SmartDropdownConfig.svelte`: "Quellfeld" (the earlier select this field's options depend on), a
  // browse dialog grouped like v3 (by page here, v3 grouped by stage), and "Optionen konfigurieren" with a count badge.
  // The state is the form entry's `choice_filter` (`choice.ts`); a filter of another shape shows read-only as "Regel".
  // v3's "Mehrfachauswahl erlauben" is the field's type here (Felddefinition), not a switch of this section.
  import Search from '@lucide/svelte/icons/search';
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import type { Translate } from '../../shell/messages';
  import type { ChoiceFilter, SmartSource, SourceOption } from './choice';
  import SmartDropdownMappingModal from './SmartDropdownMappingModal.svelte';

  interface Props {
    t: Translate;
    filter: ChoiceFilter;
    /** The selects earlier in this form. */
    sources: readonly SmartSource[];
    /** The options of this field. */
    options: readonly SourceOption[];
    /** A Quellfeld picked (its key), or removed. */
    onsource: (key: string | undefined) => void;
    ontoggle: (when: string, option: string, on: boolean) => void;
    /** A new option typed in the dialog; it is offered for `when` at once. */
    onadd: (label: string, when: string) => void;
  }
  let { t, filter, sources, options, onsource, ontoggle, onadd }: Props = $props();

  let pickerOpen = $state(false);
  let modalOpen = $state(false);

  const smart = $derived(filter.kind === 'smart' ? filter : undefined);
  const selected = $derived(sources.find((s) => s.key === smart?.source));
  const count = $derived(smart?.branches.filter((b) => b.options.length > 0).length ?? 0);
  const groups = $derived.by(() => {
    const pages = [...new Set(sources.map((s) => s.page))];
    return pages.map((page) => ({ page, sources: sources.filter((s) => s.page === page) }));
  });
</script>

<section class="smart" data-testid="cfg-smart">
  {#if filter.kind === 'foreign'}
    <div class="section">
      <Label>{t('form_smart_rule')}</Label>
      <code class="expr" data-testid="smart-foreign">{filter.expr}</code>
      <p class="hint">{t('form_smart_foreign')}</p>
    </div>
  {:else}
    <div class="section">
      <Label>{t('form_smart_source')}</Label>
      <p class="hint">{t('form_smart_source_hint')}</p>
      {#if smart !== undefined}
        <div class="chosen" data-testid="smart-source">
          <span class="chosen-name">{selected?.label ?? smart.source}</span>
          <button
            type="button"
            class="clear"
            aria-label={t('form_smart_clear_source')}
            title={t('form_smart_clear_source')}
            data-testid="smart-clear"
            onclick={() => onsource(undefined)}
          >
            <X size={14} />
          </button>
        </div>
      {:else if sources.length === 0}
        <p class="none" data-testid="smart-no-sources">{t('form_smart_no_sources')}</p>
      {:else}
        <Button variant="outline" class="wide" onclick={() => (pickerOpen = true)} data-testid="smart-browse">
          <Search size={16} />
          {t('form_smart_browse')}
        </Button>
      {/if}
    </div>

    {#if selected !== undefined && selected.options.length > 0}
      <div class="section">
        <Label>{t('form_smart_conditional')}</Label>
        <p class="hint">{t('form_smart_conditional_hint')}</p>
        <Button
          variant="outline"
          class="wide"
          onclick={() => (modalOpen = true)}
          data-testid="smart-configure"
        >
          <Settings2 size={16} />
          {t('form_smart_configure')}
          {#if count > 0}
            <span class="badge" data-testid="smart-count" aria-label={t('form_smart_configured', { count })}>
              {count}
            </span>
          {/if}
        </Button>
      </div>
    {/if}
  {/if}
</section>

<Dialog.Root bind:open={pickerOpen}>
  <Dialog.Content class="smart-picker sm:max-w-[560px]" data-testid="smart-picker">
    <Dialog.Header>
      <Dialog.Title>{t('form_smart_picker_title')}</Dialog.Title>
      <Dialog.Description>{t('form_smart_picker_desc')}</Dialog.Description>
    </Dialog.Header>
    <div class="picker-body">
      {#each groups as group (group.page)}
        <div class="group">
          <div class="group-head">{t('form_smart_page', { n: group.page + 1 })}</div>
          {#each group.sources as source (source.key)}
            <button
              type="button"
              class="card"
              class:selected={source.key === smart?.source}
              data-testid={`smart-source-${source.key}`}
              onclick={() => {
                onsource(source.key);
                pickerOpen = false;
              }}
            >
              <span class="card-head">
                <span class="card-name">{source.label}</span>
                <span class="card-type">
                  {source.multi ? t('form_smart_type_multiple') : t('form_smart_type_dropdown')}
                </span>
              </span>
              <span class="tags">
                {#each source.options as option (option.key)}
                  <span class="tag">{option.label}</span>
                {/each}
              </span>
            </button>
          {/each}
        </div>
      {/each}
    </div>
  </Dialog.Content>
</Dialog.Root>

{#if selected !== undefined && smart !== undefined}
  <SmartDropdownMappingModal
    bind:open={modalOpen}
    {t}
    sourceLabel={selected.label}
    tabs={selected.options}
    {options}
    branches={smart.branches}
    {ontoggle}
    {onadd}
  />
{/if}

<style>
  .smart {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .section :global(label) {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .hint {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .none {
    margin: 0;
    padding: 0.5rem;
    font-size: 0.75rem;
    font-style: italic;
    color: var(--muted-foreground);
    background: color-mix(in oklab, var(--muted) 50%, transparent);
    border-radius: 0.25rem;
  }
  .expr {
    padding: 0.5rem;
    overflow-wrap: anywhere;
    font-size: 0.75rem;
    background: var(--muted);
    border-radius: 0.25rem;
  }
  .chosen {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 2.75rem;
    padding: 0.5rem;
    background: color-mix(in oklab, var(--primary) 10%, transparent);
    border: 1px solid color-mix(in oklab, var(--primary) 30%, transparent);
    border-radius: 0.375rem;
  }
  .chosen-name {
    min-width: 0;
    overflow: hidden;
    font-size: 0.8125rem;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .clear {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    color: var(--muted-foreground);
    cursor: pointer;
    background: transparent;
    border: none;
    border-radius: 0.25rem;
  }
  .clear:hover {
    color: var(--destructive);
    background: color-mix(in oklab, var(--destructive) 10%, transparent);
  }
  .smart :global(.wide) {
    justify-content: center;
    width: 100%;
    min-height: 2.75rem;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.375rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--primary-foreground);
    background: var(--primary);
    border-radius: 9999px;
  }
  .picker-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-height: min(400px, 60dvh);
    overflow-y: auto;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .group-head {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    padding: 0.75rem;
    text-align: left;
    cursor: pointer;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }
  .card:hover {
    background: color-mix(in oklab, var(--accent) 50%, transparent);
    border-color: color-mix(in oklab, var(--primary) 50%, transparent);
  }
  .card.selected {
    background: color-mix(in oklab, var(--primary) 8%, transparent);
    border-color: var(--primary);
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .card-name {
    font-size: 0.875rem;
    font-weight: 500;
  }
  .card-type {
    padding: 0.125rem 0.375rem;
    font-size: 0.625rem;
    color: var(--muted-foreground);
    white-space: nowrap;
    background: var(--muted);
    border-radius: 0.25rem;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .tag {
    padding: 0.125rem 0.5rem;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
    background: color-mix(in oklab, var(--muted) 70%, transparent);
    border-radius: 9999px;
  }
</style>
