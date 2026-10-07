<script lang="ts">
  // v3 FieldHistoryDialog + DefaultHistoryView: "Verlauf — <label>", max-w-2xl, one row per value with its time, the
  // cleared ones as an italic "Geleert", odd rows shaded, the list scrolling inside 60vh.
  import type { HistoryRow } from '@ueberblick/ui';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { message, type Locale } from '../../messages';
  import { historyTime } from './history';

  interface Props {
    open: boolean;
    label: string;
    entries: readonly HistoryRow[];
    locale: Locale;
  }
  let { open = $bindable(), label, entries, locale }: Props = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-2xl sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>{message(locale, 'feature_history_title')} — {label}</Dialog.Title>
    </Dialog.Header>
    {#if entries.length === 0}
      <div class="p-4 text-center text-sm text-muted-foreground">
        {message(locale, 'feature_history_empty')}
      </div>
    {:else}
      <ol class="m-0 flex max-h-[60vh] list-none flex-col gap-1 overflow-y-auto p-0">
        {#each entries as row (row.key)}
          <li class="flex items-baseline justify-between gap-3 rounded-sm px-2.5 py-2 odd:bg-muted/50">
            <span class="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {historyTime(row.at, locale)}
            </span>
            {#if row.cleared}
              <span class="text-right font-normal text-muted-foreground italic">
                {message(locale, 'feature_history_cleared')}
              </span>
            {:else}
              <span class="text-right font-medium break-words text-foreground">{row.value}</span>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  </Dialog.Content>
</Dialog.Root>
