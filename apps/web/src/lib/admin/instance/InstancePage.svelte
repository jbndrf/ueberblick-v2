<script lang="ts">
  // v3 `admin/instance/+page.svelte`: the operator's page for the consent banner and the legal pages. The data comes
  // from the page's load, the writes go through `api` (`/api/instance/*`, WP-638).
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { InstanceApi } from './api';
  import ConsentCard from './ConsentCard.svelte';
  import LegalPageCard from './LegalPageCard.svelte';
  import NewPageCard from './NewPageCard.svelte';
  import type { InstanceSettingsView, LegalPageView } from './model';

  let {
    settings,
    pages,
    locale,
    api,
    reload,
  }: {
    settings: InstanceSettingsView;
    pages: readonly LegalPageView[];
    locale: Locale;
    api: InstanceApi;
    reload: () => Promise<void>;
  } = $props();
  const t = (key: Parameters<typeof adminMessage>[1]): string => adminMessage(locale, key);
</script>

<div class="mx-auto max-w-4xl space-y-6" data-testid="instance-page">
  <div>
    <h1 class="text-2xl font-semibold">{t('inst_title')}</h1>
    <p class="mt-1 text-sm text-muted-foreground">{t('inst_description')}</p>
  </div>

  <ConsentCard {settings} {locale} {api} {reload} />

  <div>
    <h2 class="text-lg font-semibold">{t('inst_pages_title')}</h2>
    <p class="mt-1 text-sm text-muted-foreground">{t('inst_pages_desc')}</p>
  </div>

  {#each pages as page (page.slug)}
    <LegalPageCard {page} {locale} {api} {reload} />
  {/each}

  <NewPageCard {locale} {api} {reload} />
</div>
