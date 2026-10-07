<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { createParticipantsApi } from '../../../../../../lib/admin/participants/api';
  import ParticipantsPage from '../../../../../../lib/admin/participants/ParticipantsPage.svelte';
  import { adminMessage } from '../../../shell/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const api = $derived(
    createParticipantsApi({
      project: page.params['projectId'] ?? '',
      language: data.locale,
      fetch: (input, init) => fetch(input, init),
      fallback: adminMessage(data.locale, 'prt_update_error'),
    }),
  );

  /** v3: the guests switch is a URL parameter, so the server load decides which people the list holds. */
  function showGuests(show: boolean): void {
    const url = new URL(page.url);
    if (show) url.searchParams.set('showGuests', 'true');
    else url.searchParams.delete('showGuests');
    void goto(url.pathname + url.search, { keepFocus: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>{adminMessage(data.locale, 'prt_title')} - {adminMessage(data.locale, 'product')}</title>
</svelte:head>

<ParticipantsPage
  {data}
  locale={data.locale}
  origin={page.url.origin}
  {api}
  reload={invalidateAll}
  onGuests={showGuests}
/>
