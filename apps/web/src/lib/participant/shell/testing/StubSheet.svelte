<script lang="ts">
  // A sheet for the registry tests: it says that it is open and for which feature.
  import type { SheetProps } from '../sheets';
  let { ctx, onclose, featureId }: SheetProps = $props();
</script>

<div data-testid="stub-sheet">
  <p>stub sheet {featureId ?? ''}</p>
  <button type="button" onclick={onclose}>close stub</button>
  <button type="button" onclick={() => ctx.setPlacing(true)}>pin on</button>
  <button type="button" onclick={() => ctx.setPlacing(false)}>pin off</button>
  <button type="button" onclick={() => ctx.setForm(true)}>form on</button>
  <p>picker {ctx.pickerShown ? 'shown' : 'hidden'}</p>
  <p>zuletzt {ctx.recentOpen ? 'open' : 'closed'}</p>
</div>
