<script lang="ts">
  // The Offline tab of Einstellungen (v3 `SettingsSheet.svelte:556-870`): the install card, the offline data
  // ("Kartenkacheln") with its pack selector, "Offline-Bilder" (WP-667), and the storage section.
  import { message, type Locale } from '../../../messages';
  import type { OfflineContext } from '../../../offline/context';
  import ImagesCard from './ImagesCard.svelte';
  import PackageDialog from './PackageDialog.svelte';
  import PwaCard from './PwaCard.svelte';
  import StorageCard from './StorageCard.svelte';
  import TilesCard from './TilesCard.svelte';

  interface Props {
    context: OfflineContext;
    locale: Locale;
    /** Features on the device (the sync status). */
    records: number;
  }
  let { context, locale, records }: Props = $props();

  let choosing = $state(false);
</script>

<div class="space-y-4">
  <PwaCard pwa={context.pwa} {locale} />

  <div class="space-y-2">
    <h4 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {message(locale, 'offline_data_heading')}
    </h4>
    <TilesCard offline={context.offline} {locale} onchoose={() => (choosing = true)} />
    <ImagesCard images={context.images} {locale} />
  </div>

  <StorageCard {context} {locale} {records} />
</div>

<PackageDialog bind:open={choosing} offline={context.offline} {locale} />
