<script lang="ts">
  // v3 boolean-field: a switch where the cell is editable, a Yes/No badge otherwise.
  import { Switch } from '../../../ui/switch';
  import { Badge } from '../../../ui/badge';
  import { m } from '../../../../paraglide/messages.js';
  import { commitCell } from './commit';
  import type { CellProps } from '../types';

  let props: CellProps = $props();
  const { value, column, editable } = $derived(props);
  const on = $derived(value === true || value === 'true' || value === 1);
</script>

{#if editable}
  <Switch
    checked={on}
    aria-label={column.label}
    onCheckedChange={(checked) => void commitCell(props, checked)}
  />
{:else}
  <Badge variant={on ? 'default' : 'secondary'}>{on ? m.table_yes() : m.table_no()}</Badge>
{/if}
