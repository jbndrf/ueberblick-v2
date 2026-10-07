<script lang="ts">
  // The sidebar's draft badge under the project name (v3 `admin/+layout.svelte:354-373`: an amber link with a
  // flask icon that said the project is a draft). In v3 it led to "Status & Freigabe"; here it shows the
  // draft state (§10.18) and leads to the project's Versionen page, v3's successor of that status page (A-030).
  import FlaskConical from '@lucide/svelte/icons/flask-conical';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { draftStatus } from './status-store.svelte';

  let { locale, project }: { locale: Locale; project: string } = $props();

  const status = $derived(draftStatus.project === project ? draftStatus.status : null);
  const label = $derived(
    status?.neverPublished
      ? adminMessage(locale, 'draft_badge_never')
      : status?.dirty
        ? adminMessage(locale, 'draft_badge_unpublished')
        : null,
  );
</script>

{#if label !== null}
  <a
    href="/admin/projects/{project}/versions"
    data-testid="draft-badge"
    class="mb-2 flex items-center gap-2 rounded-md bg-amber-100 px-2 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-200"
  >
    <FlaskConical class="h-3.5 w-3.5 shrink-0" />
    {label}
  </a>
{/if}
