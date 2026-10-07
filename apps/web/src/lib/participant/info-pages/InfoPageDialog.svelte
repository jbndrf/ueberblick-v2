<script lang="ts">
  // The page dialog (v3 `SettingsSheet.svelte:875-895`): title and body in a dialog capped at 80 vh and `sm:max-w-lg`,
  // the body scrolling inside, QR variables drawn as codes. Serves info pages and legal pages alike (v3 ran both through
  // `parseInfoPage`).
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { message, type Locale } from '../messages';
  import type { PageEntry } from './pages';
  import QrCode from './QrCode.svelte';
  import { parseInfoPage, type InfoLogin } from './render';

  interface Props {
    open: boolean;
    locale: Locale;
    page: PageEntry | undefined;
    login: InfoLogin | null;
  }
  let { open = $bindable(), locale, page, login }: Props = $props();

  const segments = $derived(page === undefined ? [] : parseInfoPage(page.content, login));
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[80vh] flex-col gap-4 overflow-hidden sm:max-w-lg">
    <Dialog.Header class="shrink-0">
      <Dialog.Title>{page?.title ?? ''}</Dialog.Title>
    </Dialog.Header>
    <div class="info-content min-h-0 flex-1 overflow-y-auto break-words" data-testid="info-body">
      {#each segments as seg, i (i)}
        {#if seg.kind === 'html'}
          {@html seg.html}
        {:else}
          <div class="my-3 flex justify-center">
            <QrCode value={seg.value} label={message(locale, 'settings_info_qr')} />
          </div>
        {/if}
      {/each}
    </div>
  </Dialog.Content>
</Dialog.Root>
