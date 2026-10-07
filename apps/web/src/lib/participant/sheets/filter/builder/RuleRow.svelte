<script lang="ts">
  // A term of the saved view that has no row of its own (written by hand or by an assistant, H4): shown as it is and
  // kept when the view is saved. v3 had no such case (it stored its own clause list); it is what stops a save from
  // dropping a term the person cannot see.
  import type { RuleClause } from '@ueberblick/core/filters';
  import { message, type Locale } from '../../../messages';
  import ClauseFrame from './ClauseFrame.svelte';

  interface Props {
    clause: RuleClause;
    typeLabel: string | undefined;
    locale: Locale;
    onremove: () => void;
  }
  let { clause, typeLabel, locale, onremove }: Props = $props();
</script>

<ClauseFrame
  {locale}
  kind="rule"
  caps
  title={message(locale, 'filter_builder_clause_rule')}
  subtitle={typeLabel ?? clause.type}
  {onremove}
>
  <code class="block rounded bg-muted px-2 py-1 text-xs break-words">{clause.source}</code>
</ClauseFrame>
