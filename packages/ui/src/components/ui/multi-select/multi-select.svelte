<script lang="ts">
  // v3's MobileMultiSelect (reference/src/lib/components/mobile-multi-select.svelte), ported as is: a trigger that opens
  // a full-screen dialog below 768 px (sized to the visual viewport so the keyboard never covers it) and a portalled
  // dropdown with arrow-key navigation above. Search, create by typing, single-select, "N ausgewählt" summary, badges.
  import { onMount, tick } from 'svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Badge } from '../badge';
  import { Button } from '../button';
  import { m } from '../../../paraglide/messages.js';
  import { cn } from '../../../utils.js';
  import { portal } from './portal';
  import { isInsideModal } from '../dialog/modal-context';
  import MultiSelectSearch from './multi-select-search.svelte';
  import MultiSelectList from './multi-select-list.svelte';
  import { isMobile as phone } from '../../../breakpoint/is-mobile';
  import type { MultiSelectLabels, MultiSelectOption } from './types';

  let {
    options = $bindable([]),
    selected = $bindable([]),
    singleSelect = false,
    disabled = false,
    class: className = '',
    allowCreate = false,
    onCreate,
    labels: labelOverrides = {},
    hideSelected = false,
    autoAddCreated = false,
    summarizeMultiple = false,
    onSelectedChange,
    disablePortal,
    id,
    invalid = false,
    describedby,
  }: {
    options?: MultiSelectOption[];
    /** Values of the picked options. */
    selected?: string[];
    singleSelect?: boolean;
    disabled?: boolean;
    class?: string;
    allowCreate?: boolean;
    /** Creates the option for a typed name and returns it; the parent updates `options` unless `autoAddCreated`. */
    onCreate?: ((label: string) => Promise<MultiSelectOption> | MultiSelectOption) | undefined;
    labels?: Partial<MultiSelectLabels>;
    /** Hide picked options from the list (default: they stay, with a filled dot). */
    hideSelected?: boolean;
    autoAddCreated?: boolean;
    /** Several picks show as "N ausgewählt" instead of badges in the trigger. */
    summarizeMultiple?: boolean;
    onSelectedChange?: (values: string[]) => void;
    /** For use inside a dialog that is already portalled. */
    disablePortal?: boolean;
    /** Id of the trigger, so a field's label names it (WP-642). */
    id?: string | undefined;
    /** Red border on the trigger; the message is linked with `describedby`. */
    invalid?: boolean;
    describedby?: string | undefined;
  } = $props();

  const labels: MultiSelectLabels = $derived({
    placeholder: m.multi_select_placeholder(),
    search: m.multi_select_search(),
    empty: m.multi_select_empty(),
    createHint: m.multi_select_create_hint(),
    createLabel: (query) => m.multi_select_create_label({ query }),
    countSelected: (count) => m.multi_select_count_selected({ count }),
    removeOption: (option) => m.multi_select_remove_option({ option }),
    done: m.multi_select_done(),
    doneWithCount: (count) => m.multi_select_done_with_count({ count }),
    close: m.multi_select_close(),
    dialog: m.multi_select_dialog_label(),
    options: m.multi_select_options_label(),
    ...labelOverrides,
  });

  // Inside a kit dialog the body portal would be inert, so render in place unless the caller says otherwise.
  const inPlace = $derived(disablePortal ?? isInsideModal());

  let isOpen = $state(false);
  const isMobile = $derived(phone());
  let query = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let dropdown = $state<HTMLDivElement | null>(null);
  let viewportHeight = $state(0);
  let position = $state({ top: 0, left: 0, width: 0 });
  let highlightedIndex = $state(-1);
  let openUpward = $state(false);

  // Chips in the canonical option order (display only; the emitted order stays as the user picked).
  const selectedOptions = $derived(options.filter((o) => selected.includes(o.value)));
  const filtered = $derived.by(() => {
    const needle = query.toLowerCase();
    return options.filter(
      (o) =>
        !(hideSelected && selected.includes(o.value)) &&
        (o.label.toLowerCase().includes(needle) || (o.description?.toLowerCase().includes(needle) ?? false)),
    );
  });
  const exactMatch = $derived(options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase()));
  const canCreate = $derived(allowCreate && query.trim() !== '' && !exactMatch && onCreate !== undefined);

  function toggle(option: MultiSelectOption) {
    if (singleSelect) {
      selected = [option.value];
      close();
    } else if (selected.includes(option.value)) {
      selected = selected.filter((v) => v !== option.value);
    } else {
      selected = [...selected, option.value];
      // Clear the search when that was the last visible match.
      if (query && filtered.every((o) => o.value === option.value)) query = '';
    }
  }

  function remove(value: string, event?: Event) {
    event?.stopPropagation();
    selected = selected.filter((v) => v !== value);
  }

  async function create() {
    if (!canCreate || !onCreate) return;
    try {
      const made = await onCreate(query.trim());
      if (autoAddCreated) options = [...options, made];
      if (singleSelect) {
        selected = [made.value];
        close();
      } else {
        selected = [...selected, made.value];
      }
      query = '';
    } catch (error) {
      console.error('Failed to create option:', error);
    }
  }

  function onSearchKeydown(e: KeyboardEvent) {
    const total = (canCreate ? 1 : 0) + filtered.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (total > 0) highlightedIndex = (highlightedIndex + 1) % total;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (total > 0) highlightedIndex = highlightedIndex <= 0 ? total - 1 : highlightedIndex - 1;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0) {
        if (canCreate && highlightedIndex === 0) void create();
        else {
          const option = filtered[canCreate ? highlightedIndex - 1 : highlightedIndex];
          if (option) toggle(option);
        }
      } else if (canCreate) void create();
    } else if (e.key === 'Backspace' && query === '' && selectedOptions.length > 0 && !singleSelect) {
      e.preventDefault();
      const last = selectedOptions[selectedOptions.length - 1];
      if (last) remove(last.value);
    } else if (e.key === 'Escape') {
      close();
    }
  }

  const visualViewport = () =>
    typeof window === 'undefined' ? undefined : (window.visualViewport ?? undefined);
  function syncViewport() {
    viewportHeight = visualViewport()?.height ?? window.innerHeight;
  }

  // The phone keyboard stays open while rows are tapped: a tap moves focus off the search field, so give it back
  // (v3 cancelled the press on mouse/touch down instead; a press must stay cancellable, WCAG 2.5.2).
  let searchHadFocus = false;
  const onSearchFocus = () => (searchHadFocus = true);
  function onSearchBlur(e: FocusEvent) {
    const next = e.relatedTarget as HTMLElement | null;
    if (next && !next.closest('[data-ms-row]')) searchHadFocus = false;
  }
  function keepKeyboard<A extends unknown[]>(act: (...args: A) => unknown) {
    return (...args: A) => {
      const result = act(...args);
      if (isMobile && searchHadFocus) searchInput?.focus();
      return result;
    };
  }

  function open() {
    if (disabled) return;
    searchHadFocus = false;
    isOpen = true;
    query = '';
    highlightedIndex = -1;
    if (isMobile) {
      syncViewport();
      visualViewport()?.addEventListener('resize', syncViewport);
      document.body.style.overflow = 'hidden'; // no scroll bleed-through behind the dialog
    } else if (trigger) {
      const rect = trigger.getBoundingClientRect();
      const height = 280; // max-h-60 plus the search row
      const below = window.innerHeight - rect.bottom;
      openUpward = below < height && rect.top > below;
      position = { top: openUpward ? rect.top - 4 : rect.bottom + 4, left: rect.left, width: rect.width };
    }
  }

  function close() {
    isOpen = false;
    query = '';
    visualViewport()?.removeEventListener('resize', syncViewport);
    document.body.style.overflow = '';
  }

  function onOutsideClick(e: MouseEvent) {
    if (isMobile || !isOpen) return;
    const target = e.target as Node;
    if (trigger && !trigger.contains(target) && dropdown && !dropdown.contains(target)) close();
  }
  function onDocumentKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) close();
  }

  onMount(() => {
    syncViewport();
    document.addEventListener('click', onOutsideClick);
    document.addEventListener('keydown', onDocumentKeydown);
    return () => {
      document.removeEventListener('click', onOutsideClick);
      document.removeEventListener('keydown', onDocumentKeydown);
      visualViewport()?.removeEventListener('resize', syncViewport);
      document.body.style.overflow = '';
    };
  });

  // Desktop: focus the search; the phone keyboard only opens when the user taps the field.
  $effect(() => {
    if (isOpen && !isMobile && searchInput) void tick().then(() => searchInput?.focus());
  });
  $effect(() => {
    void query;
    highlightedIndex = -1;
  });
  $effect(() => {
    if (highlightedIndex >= 0 && dropdown && !isMobile) {
      dropdown.querySelectorAll('[role="option"]')[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  });

  // Tell the parent when the picks change (not at mount); compared by value, so a fresh array literal is no loop.
  let lastEmitted: string[] = (() => selected.slice())();
  $effect(() => {
    const ids = selected;
    if (lastEmitted.length === ids.length && lastEmitted.every((v, i) => v === ids[i])) return;
    lastEmitted = ids.slice();
    onSelectedChange?.(ids);
  });
</script>

<div class={cn('relative', className)}>
  <button
    bind:this={trigger}
    {id}
    type="button"
    onclick={() => (isOpen ? close() : open())}
    {disabled}
    aria-haspopup={isMobile ? 'dialog' : 'listbox'}
    aria-expanded={isOpen}
    aria-describedby={describedby}
    class={cn(
      'flex min-h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors',
      'hover:bg-accent/50 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none',
      invalid && 'border-destructive',
      disabled && 'cursor-not-allowed opacity-50',
    )}
  >
    {#if selectedOptions.length === 0}
      <span class="flex-1 truncate text-left text-muted-foreground">{labels.placeholder}</span>
    {:else if selectedOptions.length === 1}
      <span class="flex-1 truncate text-left">{selectedOptions[0]?.label}</span>
    {:else if summarizeMultiple || isOpen}
      <span class="flex-1 truncate text-left">{labels.countSelected(selectedOptions.length)}</span>
    {:else}
      <div class="pointer-events-none flex flex-1 flex-wrap gap-1 overflow-hidden">
        {#each selectedOptions as option (option.value)}
          <Badge variant="secondary" class="shrink-0 text-xs">{option.label}</Badge>
        {/each}
      </div>
    {/if}
    <ChevronDown
      class={cn('ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
    />
  </button>

  {#if isOpen && isMobile}
    <!-- Full-screen dialog, portalled so the backdrop blurs the whole page. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-[1300]" onkeydown={onDocumentKeydown} use:portal={!inPlace}>
      <div
        class="absolute inset-0 touch-none bg-black/50 backdrop-blur-md"
        onclick={close}
        onkeydown={null}
        role="button"
        tabindex="-1"
        aria-label={labels.close}
      ></div>
      <!-- The visual viewport shrinks when the keyboard opens, so the dialog shrinks with it. -->
      <div
        class="absolute right-0 left-0 flex flex-col overflow-hidden rounded-xl bg-background shadow-xl transition-all duration-150"
        style="top: {viewportHeight * 0.1}px; height: {viewportHeight * 0.8}px;"
        role="dialog"
        aria-modal="true"
        aria-label={labels.dialog}
      >
        <div class="shrink-0 border-b border-border p-4">
          <MultiSelectSearch
            size="lg"
            {selectedOptions}
            {singleSelect}
            {labels}
            bind:query
            bind:input={searchInput}
            onremove={remove}
            onkeydown={onSearchKeydown}
            onfocus={onSearchFocus}
            onblur={onSearchBlur}
          />
        </div>
        <div class="flex-1 overflow-auto overscroll-contain">
          <MultiSelectList
            size="lg"
            single={singleSelect}
            options={filtered}
            selectedIds={selected}
            {canCreate}
            {query}
            {highlightedIndex}
            {labels}
            onToggle={keepKeyboard(toggle)}
            onCreate={keepKeyboard(create)}
          />
        </div>
        <div class="shrink-0 border-t border-border p-4">
          <Button class="w-full" onclick={close}>
            {selectedOptions.length > 0 ? labels.doneWithCount(selectedOptions.length) : labels.done}
          </Button>
        </div>
      </div>
    </div>
  {/if}

  {#if isOpen && !isMobile}
    <div
      bind:this={dropdown}
      class="fixed z-[9999] overflow-hidden rounded-md border border-border bg-popover shadow-lg"
      style="top: {position.top}px; left: {position.left}px; width: {position.width}px;{openUpward
        ? ' transform: translateY(-100%);'
        : ''}"
      use:portal={!inPlace}
    >
      <div class="sticky top-0 border-b border-border bg-popover p-2">
        <MultiSelectSearch
          size="sm"
          {selectedOptions}
          {singleSelect}
          {labels}
          bind:query
          bind:input={searchInput}
          onremove={remove}
          onkeydown={onSearchKeydown}
        />
      </div>
      <!-- The listbox holds only the options; the search sits beside it (aria-required-children). -->
      <div
        class="max-h-60 overflow-auto"
        role="listbox"
        aria-label={labels.options}
        aria-multiselectable={singleSelect ? undefined : true}
      >
        <MultiSelectList
          size="sm"
          options={filtered}
          selectedIds={selected}
          {canCreate}
          {query}
          {highlightedIndex}
          {labels}
          onToggle={toggle}
          onCreate={create}
        />
      </div>
    </div>
  {/if}
</div>
