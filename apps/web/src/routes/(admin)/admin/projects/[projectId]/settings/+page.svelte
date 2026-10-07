<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { createSettingsApi } from '../../../../../../lib/admin/settings/api';
  import { DEFAULT_SECTION } from '../../../../../../lib/admin/settings/sections';
  import SettingsPage from '../../../../../../lib/admin/settings/SettingsPage.svelte';
  import { adminMessage } from '../../../shell/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData & { locale: 'de' | 'en' } } = $props();

  const project = $derived(page.params['projectId'] ?? '');
  const api = $derived(
    createSettingsApi({
      project,
      language: data.locale,
      fetch: (input, init) => fetch(input, init),
      fallback: adminMessage(data.locale, 'settings_err_failed'),
      upload: {
        tooLarge: adminMessage(data.locale, 'settings_icon_too_large'),
        badType: adminMessage(data.locale, 'settings_icon_bad_type'),
        fallback: adminMessage(data.locale, 'settings_icon_upload_error'),
      },
    }),
  );

  /** v3 `selectSection`: the section is in the URL, so a link and a reload keep it; the default leaves no parameter. */
  function select(id: string): void {
    const url = new URL(page.url);
    if (id === DEFAULT_SECTION) url.searchParams.delete('section');
    else url.searchParams.set('section', id);
    void goto(url, { keepFocus: true, noScroll: true, replaceState: false });
  }
</script>

<svelte:head>
  <title>{adminMessage(data.locale, 'nav_project_settings')} - {adminMessage(data.locale, 'product')}</title>
</svelte:head>

<SettingsPage
  {data}
  locale={data.locale}
  {project}
  {api}
  reload={invalidateAll}
  current={page.url.searchParams.get('section')}
  onselect={select}
/>
