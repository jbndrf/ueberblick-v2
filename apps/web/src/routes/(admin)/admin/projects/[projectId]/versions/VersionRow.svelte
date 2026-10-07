<script lang="ts">
  // One row of v3's Releases list (`releases/+page.svelte:28-40`): `v{n}` bold, a status badge, the Workflow icon with the
  // count (here Objektarten), the date at the right. `flex-wrap` lets the row break on a phone. `actions` takes extra row
  // actions (WP-368: "n Objekte noch auf dieser Version" and "Auf aktuelle Version verschieben").
  import Workflow from '@lucide/svelte/icons/workflow';
  import type { Snippet } from 'svelte';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { adminMessage } from '../../../shell/messages';
  import type { Locale } from '../../../shell/locale';
  import type { VersionLine } from './types';

  interface Props {
    locale: Locale;
    line: VersionLine;
    /** The leading control (the compare checkbox). */
    lead?: Snippet;
    actions?: Snippet;
  }
  let { locale, line, lead, actions }: Props = $props();
  const t = (key: Parameters<typeof adminMessage>[1], values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  // v3 `fmt` (`:8-12`): an unreadable date shows nothing.
  const date = (s: string): string => {
    const d = new Date(s);
    return s === '' || Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale);
  };
</script>

<li
  class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3"
  data-version={line.version}
  data-status={line.status}
>
  {@render lead?.()}
  <span class="text-lg font-bold">v{line.version}</span>
  {#if line.status === 'deployed'}
    <Badge>{t('versions_status_deployed')}</Badge>
  {:else}
    <span class="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
      >{t('versions_status_retired')}</span
    >
  {/if}
  <span class="flex items-center gap-1 text-sm text-muted-foreground">
    <Workflow class="h-3.5 w-3.5" />
    {t('versions_objektarten', { count: line.objektarten })}
  </span>
  {#if line.template !== null}
    <span class="text-sm"
      >{t('versions_template', { template: line.template, version: line.templateVersion ?? '' })}</span
    >
  {/if}
  <span class="text-xs text-muted-foreground sm:ml-auto">{date(line.createdAt)}</span>
  {@render actions?.()}
</li>
