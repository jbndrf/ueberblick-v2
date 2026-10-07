<script lang="ts">
  // One QR code (v3 `QrCode`): the encoder is a separate chunk that loads only when a page with a QR variable opens.
  import { qrSvg } from '../../admin/participants/qr';

  let { value, label }: { value: string; label: string } = $props();
  let svg = $state('');
  $effect(() => {
    const wanted = value;
    void qrSvg(wanted).then((s) => {
      if (wanted === value) svg = s;
    });
  });
</script>

<div
  class="h-48 w-48 rounded bg-white p-1"
  role="img"
  aria-label={label}
  data-testid="info-qr"
  data-value={value}
>
  {@html svg}
</div>
