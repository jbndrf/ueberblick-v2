<script lang="ts">
  // A sortable list of three rows for the component specs.
  import { Sortable, type Reorder } from '../components/ui/sortable';

  let {
    initial = ['a', 'b', 'c'],
    onreorder = () => undefined,
    disabled = false,
  }: { initial?: string[]; onreorder?: (change: Reorder) => void; disabled?: boolean } = $props();
  // svelte-ignore state_referenced_locally
  let order = $state(initial);
</script>

<Sortable
  items={order}
  key={(k) => k}
  label="Letters"
  handleLabel={(k) => `Move ${k}`}
  upLabel={(k) => `Up ${k}`}
  downLabel={(k) => `Down ${k}`}
  announce={(k, at, total) => `${k}, ${at} of ${total}`}
  {disabled}
  testId={(k) => `row-${k}`}
  onreorder={(c) => {
    order = c.keys;
    onreorder(c);
  }}
>
  {#snippet row(k, i, grip, moves)}
    <div class="flex items-center gap-2 p-2">
      {@render grip(k)}
      <span>{k}</span>
      {@render moves(k, i)}
    </div>
  {/snippet}
</Sortable>
