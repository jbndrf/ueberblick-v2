<script lang="ts">
  // v3's relation path in the detail header (RelationPath.svelte): the parent chain and the relation it came through,
  // alternating, then the current level. Relation segments carry the open-work count of their children; the current
  // level's ⌄ lists its own relations with child counts and "{name} anlegen". Several parents: the first segment's ⌄
  // switches the chain. A long path collapses its middle ("… ›"), tapping the dots shows it all.
  // The data comes from the device (`nav.ts`); this file only draws it and reports taps.
  import { LAYER } from '../../layers';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Plus from '@lucide/svelte/icons/plus';
  import * as DropdownMenu from '@ueberblick/ui/components/ui/dropdown-menu';
  import type { FeatureId } from '@ueberblick/core/model';
  import { message, type Locale } from '../../messages';
  import type { Hop, RelationNav } from './nav';

  interface Props {
    nav: RelationNav;
    id: FeatureId;
    /** The current level's title (the Objektart). */
    title: string;
    locale: Locale;
    /** A relation of this feature opened in the sheet body, or undefined. */
    openGroup: string | undefined;
    chains: readonly (readonly Hop[])[];
    chainIndex: number;
    /** Children that lead to open work: of one group, or of all groups of a parent. Counted after the sheet is open. */
    openWork: (parent: FeatureId, group?: string) => number;
    onselectchain: (index: number) => void;
    onopen: (id: FeatureId) => void;
    onopengroup: (parent: FeatureId, group: string) => void;
    onclosegroup: () => void;
    oncreate: (group: string) => void;
  }
  let {
    nav,
    id,
    title,
    locale,
    openGroup,
    chains,
    chainIndex,
    openWork,
    onselectchain,
    onopen,
    onopengroup,
    onclosegroup,
    oncreate,
  }: Props = $props();

  type Segment =
    | { type: 'instance'; id: FeatureId; self: boolean }
    | { type: 'relation'; parent: FeatureId; group: string; current: boolean }
    | { type: 'current' };

  const segments = $derived.by((): Segment[] => {
    const out: Segment[] = [];
    for (const hop of chains[chainIndex] ?? []) {
      out.push({ type: 'instance', id: hop.parent, self: false });
      out.push({ type: 'relation', parent: hop.parent, group: hop.group, current: false });
    }
    if (openGroup !== undefined) {
      out.push({ type: 'instance', id, self: true });
      out.push({ type: 'relation', parent: id, group: openGroup, current: true });
    } else out.push({ type: 'current' });
    return out;
  });

  /** Long paths collapse the middle: first › … › last two. */
  let expanded = $state(false);
  $effect(() => {
    void id;
    void openGroup;
    expanded = false;
  });
  const collapsed = $derived(!expanded && segments.length > 4);
  const visible = $derived.by((): readonly (Segment | null)[] => {
    const first = segments[0];
    return collapsed && first ? [first, null, ...segments.slice(-2)] : segments;
  });

  let scroller = $state<HTMLDivElement | null>(null);
  $effect(() => {
    if (expanded && scroller) scroller.scrollLeft = scroller.scrollWidth;
  });

  const typeName = (at: FeatureId): string => nav.summary(at)?.typeLabel || '…';
  const chainLabel = (chain: readonly Hop[]): string => chain.map((h) => typeName(h.parent)).join(' › ');

  // The own relations are read when the path is drawn (cheap: this feature's edges); the counts come later.
  const own = $derived(nav.groups(id));
  const ownOpenWork = $derived(own.length === 0 ? 0 : openWork(id));
</script>

{#snippet countPill(count: number)}
  {#if count > 0}
    <span
      class="ml-1 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-none font-bold text-white"
      aria-label={message(locale, 'relation_open_work', { count })}
      data-testid="relation-open-work">{count}</span
    >
  {/if}
{/snippet}

<nav aria-label={message(locale, 'relation_path')} data-testid="relation-path">
  <div
    bind:this={scroller}
    class="flex min-w-0 items-center gap-0.5 {expanded ? 'overflow-x-auto whitespace-nowrap' : ''}"
  >
    {#each visible as seg, i (i)}
      {#if i > 0}
        <ChevronRight class="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
      {/if}
      {#if seg === null}
        <button
          type="button"
          class="min-h-6 shrink-0 rounded px-1 text-sm opacity-80 hover:underline"
          aria-label={message(locale, 'relation_show_full_path')}
          onclick={(e) => {
            e.stopPropagation();
            expanded = true;
          }}>…</button
        >
      {:else if seg.type === 'instance'}
        <span class="flex min-w-0 items-center {expanded ? 'shrink-0' : 'max-w-[35%]'}">
          <button
            type="button"
            class="truncate text-sm font-medium opacity-80 hover:underline"
            title={nav.summary(seg.id)?.label}
            onclick={(e) => {
              e.stopPropagation();
              if (seg.self) onclosegroup();
              else onopen(seg.id);
            }}
          >
            {seg.self ? title : typeName(seg.id)}
          </button>
          {#if i === 0 && !seg.self && chains.length > 1}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                class="shrink-0 rounded p-0.5 opacity-80 hover:bg-primary-foreground/10"
                aria-label={message(locale, 'relation_switch_parent')}
                onclick={(e: MouseEvent) => e.stopPropagation()}
              >
                <ChevronDown class="h-3.5 w-3.5" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start" class="{LAYER.menu} w-64">
                {#each chains as chain, ci (ci)}
                  <DropdownMenu.Item
                    class={ci === chainIndex ? 'font-semibold' : ''}
                    onclick={() => onselectchain(ci)}
                  >
                    <span class="truncate">{chainLabel(chain)}</span>
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {/if}
        </span>
      {:else if seg.type === 'relation'}
        {#if seg.current}
          <h3 class="flex min-w-0 items-center truncate text-lg font-semibold">
            <span class="truncate">{nav.groupName(seg.parent, seg.group)}</span>
            {@render countPill(openWork(seg.parent, seg.group))}
          </h3>
        {:else}
          <button
            type="button"
            class="flex min-w-0 items-center text-sm font-medium opacity-80 hover:underline {expanded
              ? 'shrink-0'
              : 'max-w-[35%]'}"
            onclick={(e) => {
              e.stopPropagation();
              onopengroup(seg.parent, seg.group);
            }}
          >
            <span class="truncate">{nav.groupName(seg.parent, seg.group)}</span>
            {@render countPill(openWork(seg.parent, seg.group))}
          </button>
        {/if}
      {:else if own.length > 0}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class="flex min-w-0 items-center gap-0.5 text-left transition-opacity hover:opacity-80"
            aria-label={message(locale, 'relation_linked')}
            onclick={(e: MouseEvent) => e.stopPropagation()}
          >
            <h3 class="truncate text-lg font-semibold">{title}</h3>
            {@render countPill(ownOpenWork)}
            <ChevronDown class="h-4 w-4 shrink-0 opacity-70" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" class="{LAYER.menu} w-64">
            <DropdownMenu.Label>{message(locale, 'relation_linked')}</DropdownMenu.Label>
            {#each own as rel (rel.key)}
              {#if rel.count === 0 && rel.create}
                <DropdownMenu.Item onclick={() => oncreate(rel.key)}>
                  <Plus class="h-4 w-4" />
                  {message(locale, 'relation_create_child', { name: rel.create.name })}
                </DropdownMenu.Item>
              {:else}
                <DropdownMenu.Item onclick={() => onopengroup(id, rel.key)}>
                  <span class="flex-1 truncate">{rel.name}</span>
                  <span class="text-xs text-muted-foreground">{rel.count}</span>
                  {@render countPill(openWork(id, rel.key))}
                </DropdownMenu.Item>
              {/if}
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {:else}
        <h3 class="truncate text-lg font-semibold">{title}</h3>
      {/if}
    {/each}
  </div>
</nav>
