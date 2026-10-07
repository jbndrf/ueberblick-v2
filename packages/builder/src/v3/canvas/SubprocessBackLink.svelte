<script lang="ts">
  // S4-5: on a child's canvas, "Teilprozess von: <Elternart>" links back to the parent's builder. One link per
  // parent Objektart; absent when this Objektart is nobody's sub-process or the host gives no addresses.
  import { getBuilderContext } from '../shell/context';

  interface Props {
    parents: readonly { readonly type: string; readonly label: string }[];
  }
  let { parents }: Props = $props();
  const ctx = getBuilderContext();
</script>

{#if parents.length > 0 && ctx.typeHref !== undefined}
  <nav class="subprocess-back" data-testid="subprocess-back" aria-label={ctx.t('canvas_subprocess_of')}>
    <span>{ctx.t('canvas_subprocess_of')}</span>
    {#each parents as parent (parent.type)}
      <a href={ctx.typeHref(parent.type)} data-subprocess-parent={parent.type}>{parent.label}</a>
    {/each}
  </nav>
{/if}
