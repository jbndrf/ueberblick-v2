<!--
  The one public setup page of HTTPS_MODE=direct (WP-941): how to trust this server's certificate on a device.
  Reachable without sign-in and before the CA is trusted (through the browser warning); it shows public data only.
-->
<script lang="ts">
  import { message, type Locale } from '../../../lib/participant/messages';
  import { STEP_KEYS } from './steps';

  let {
    locale,
    ca,
    qr,
    pageUrl,
  }: {
    locale: Locale;
    /** The public CA, or null when this server has none. */
    ca: { readonly fingerprint: string } | null;
    /** Inline SVG of the QR code of `pageUrl`. */
    qr: string;
    pageUrl: string;
  } = $props();
  const t = (key: Parameters<typeof message>[1], values?: Record<string, string>) =>
    message(locale, key, values);
</script>

<svelte:head><title>{t('setup_cert_title')} - Überblick</title></svelte:head>

<main>
  <h1>{t('setup_cert_title')}</h1>
  {#if ca === null}
    <p>{t('setup_cert_not_direct')}</p>
  {:else}
    <p>{t('setup_cert_why')}</p>
    <p class="note">{t('setup_cert_warning')}</p>

    <h2>{t('setup_cert_download_heading')}</h2>
    <p><a class="entry" href="/setup/zertifikat/ca.crt" download>{t('setup_cert_download_crt')}</a></p>
    <p>
      <a class="entry secondary" href="/setup/zertifikat/ueberblick.mobileconfig" download>
        {t('setup_cert_download_ios')}
      </a>
    </p>
    <p class="note">{t('setup_cert_fingerprint', { value: ca.fingerprint })}</p>

    <h2>{t('setup_cert_steps_heading')}</h2>
    {#each STEP_KEYS as section (section.heading)}
      <h3>{t(section.heading)}</h3>
      <ol>
        {#each section.steps as step (step)}<li>{t(step)}</li>{/each}
      </ol>
    {/each}

    <h2>{t('setup_cert_qr_heading')}</h2>
    <div class="qr" role="img" aria-label={t('setup_cert_qr_label')}>{@html qr}</div>
    <p class="note">{pageUrl}</p>
  {/if}
</main>

<style>
  main {
    max-width: 36rem;
    margin: 0 auto;
    padding: 24px 16px;
    font:
      1rem/1.5 system-ui,
      sans-serif;
    color: #1a1a1a;
  }
  h2 {
    margin-top: 2rem;
  }
  .note {
    color: #444;
    word-break: break-all;
  }
  .entry {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 56px;
    padding: 0 16px;
    color: #fff;
    background: #0b57d0;
    font-weight: 600;
    border-radius: 8px;
    text-decoration: none;
  }
  .entry.secondary {
    color: #0b57d0;
    background: #fff;
    border: 2px solid #0b57d0;
  }
  .entry:focus-visible {
    outline: 3px solid #1a1a1a;
    outline-offset: 2px;
  }
  .qr {
    width: 14rem;
    max-width: 100%;
    background: #fff;
  }
  @media print {
    .entry {
      display: none;
    }
  }
</style>
