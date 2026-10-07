<script lang="ts">
  // The builder under the active saved view (v3 FilterSheet.svelte:632-640). It holds the rows while the view is
  // open (so an empty row just added stays on screen: v3 kept the rows in the page state), and saves the written
  // rule-language source on every change; `onsave` puts it on the view in the person's record. A view that was
  // written by hand opens as far as it fits rows (core `filterToClauses`); the rest stays visible as "Regel" rows.
  import { untrack } from 'svelte';
  import type { Clause, FilterSource } from '@ueberblick/core/filters';
  import type { Locale } from '../../../messages';
  import FilterBuilder from './FilterBuilder.svelte';
  import type { BuilderPort } from './port';

  interface Props {
    port: BuilderPort;
    /** The view's saved source when the builder opened; later edits are the builder's own. */
    filters: FilterSource;
    locale: Locale;
    onsave: (filters: FilterSource) => void;
  }
  let { port, filters, locale, onsave }: Props = $props();

  let clauses = $state<readonly Clause[]>(untrack(() => port.read(filters)));
</script>

<FilterBuilder
  {port}
  {clauses}
  {locale}
  onchange={(next) => {
    clauses = next;
    onsave(port.write(next));
  }}
/>
