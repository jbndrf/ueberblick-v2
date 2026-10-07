<script lang="ts">
  // v3's Einfach tab (FilterSheet.svelte:365-473, 690-708): one card per Objektart (chevron, dot, name, count,
  // master switch); expanded, one compact row per stage (dot, name, count, switch). While a view is active the
  // switches are disabled, as v3's `disabled={!!activeView}` (:430, :453).
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { markerSvgUrl } from '@ueberblick/ui';
  import type { Key } from '@ueberblick/core/model';
  import { message, type Locale } from '../../messages';
  import type { FilterController } from './filter-controller';
  import type { FilterCard } from './filter-model';
  import { typeSwitchOn, valueSwitchOn, type FilterState } from './filter-state';

  interface Props {
    cards: readonly FilterCard[];
    filter: FilterState;
    controller: FilterController;
    locale: Locale;
    /** A view is active: the switches do nothing and are disabled. */
    locked: boolean;
  }
  let { cards, filter, controller, locale, locked }: Props = $props();

  let expanded = $state<ReadonlySet<Key>>(new Set());
  function toggleExpanded(type: Key): void {
    const next = new Set(expanded);
    if (!next.delete(type)) next.add(type);
    expanded = next;
  }
  const stagesOf = (card: FilterCard): readonly string[] => card.values.map((v) => v.value);
</script>

<div class="max-h-[calc(100vh-14rem)] space-y-6 overflow-y-auto px-4 py-6">
  {#if cards.length > 0}
    <div>
      <h3 class="mb-3 text-sm font-medium">{message(locale, 'filter_objects')}</h3>
      <div class="space-y-2">
        {#each cards as card (card.type)}
          {@const isExpanded = expanded.has(card.type)}
          {@const typeOn = typeSwitchOn(filter, card.type)}
          <div class="rounded-lg border" data-card={card.type}>
            <div class="flex items-center justify-between p-3">
              <div class="flex items-center gap-2">
                {#if card.values.length > 0}
                  <button
                    type="button"
                    class="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-accent"
                    aria-expanded={isExpanded}
                    aria-label={message(locale, isExpanded ? 'filter_collapse' : 'filter_expand', {
                      name: card.label,
                    })}
                    onclick={() => toggleExpanded(card.type)}
                  >
                    {#if isExpanded}<ChevronDown class="h-3.5 w-3.5" aria-hidden="true" />{:else}<ChevronRight
                        class="h-3.5 w-3.5"
                        aria-hidden="true"
                      />{/if}
                  </button>
                {/if}
                <!-- The type's `marker`: its icon, else a dot in its colour (v3 `FilterSheet.svelte:410-423`). -->
                {#if card.look.icon !== undefined}
                  <img
                    class="h-5 w-5 shrink-0"
                    src={markerSvgUrl(card.look, 16)}
                    alt=""
                    width="16"
                    height="16"
                    data-icon="type"
                  />
                {:else}
                  <div
                    class="h-3 w-3 shrink-0 rounded-full"
                    style:background-color={card.color}
                    data-dot="type"
                  ></div>
                {/if}
                <span class="text-sm font-medium">{card.label}</span>
                <Badge variant="secondary" class="text-xs">{card.count}</Badge>
              </div>
              <Switch
                checked={typeOn}
                disabled={locked}
                aria-label={card.label}
                onCheckedChange={(on) => controller.setType(card.type, on, stagesOf(card))}
              />
            </div>

            {#if isExpanded}
              <div class="border-t">
                {#each card.values as v (v.value)}
                  <div
                    class="flex items-center justify-between p-3 pl-10"
                    style="zoom: 0.8;"
                    data-row={v.value}
                  >
                    <div class="flex items-center gap-2">
                      {#if v.look.icon !== undefined}
                        <img
                          class="h-5 w-5 shrink-0"
                          src={markerSvgUrl(v.look, 16)}
                          alt=""
                          width="16"
                          height="16"
                          data-icon="value"
                        />
                      {:else}
                        <div
                          class="h-3 w-3 shrink-0 rounded-full"
                          style:background-color={v.color}
                          data-dot="value"
                        ></div>
                      {/if}
                      <span class="text-sm font-medium">{v.label}</span>
                      <Badge variant="secondary" class="text-xs">{v.count}</Badge>
                    </div>
                    <Switch
                      checked={valueSwitchOn(filter, card.type, v.value)}
                      disabled={locked}
                      aria-label={v.label}
                      onCheckedChange={(on) => controller.setValue(card.type, v.value, on, stagesOf(card))}
                    />
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="py-8 text-center text-sm text-muted-foreground">{message(locale, 'filter_empty')}</div>
  {/if}
</div>
