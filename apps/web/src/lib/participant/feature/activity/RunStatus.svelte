<script lang="ts">
  // v3's run status badge (`taskRunStatusText`): only an own run that is not on the server yet shows one.
  import type { ActivityStatus } from '@ueberblick/core/registry';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { message, type Locale } from '../../messages';

  interface Props {
    status: ActivityStatus;
    locale: Locale;
    class?: string;
  }
  let { status, locale, class: className = '' }: Props = $props();
</script>

{#if status !== 'accepted'}
  <Badge variant="outline" class="shrink-0 text-[10px] {className}" data-testid="activity-run-status">
    {message(locale, status === 'refused' ? 'activity_status_refused' : 'activity_status_pending')}
  </Badge>
{/if}
