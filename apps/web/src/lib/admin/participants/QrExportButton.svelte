<script lang="ts">
  // v3 `participants/qr-export-button.svelte`: "QR exportieren (n)" appears while rows are ticked, shows a spinner while the
  // PDF is made, then a success or error toast. `run` makes and downloads the PDF (qr-pdf.ts).
  import Loader2 from '@lucide/svelte/icons/loader-circle';
  import QrCode from '@lucide/svelte/icons/qr-code';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';

  let { locale, count, run }: { locale: Locale; count: number; run: () => Promise<void> } = $props();

  let loading = $state(false);

  async function exportPdf(): Promise<void> {
    loading = true;
    try {
      await run();
      toast.success(adminMessage(locale, 'prt_qr_success'));
    } catch (error) {
      console.error('QR PDF export failed:', error);
      toast.error(adminMessage(locale, 'prt_qr_error'));
    } finally {
      loading = false;
    }
  }
</script>

{#if count > 0}
  <Button variant="outline" size="sm" onclick={exportPdf} disabled={loading}>
    {#if loading}
      <Loader2 class="mr-2 h-4 w-4 animate-spin" />
    {:else}
      <QrCode class="mr-2 h-4 w-4" />
    {/if}
    {adminMessage(locale, 'prt_export_qr', { count })}
  </Button>
{/if}
