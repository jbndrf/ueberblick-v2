<script lang="ts">
  import { untrack } from 'svelte';
  // The Versionen page of a project (v3 `releases/+page.svelte`): the view is `VersionsPage`, this file brings the data
  // and the calls (`createVersionsCalls`); a call that changed something reads the list again.
  import { invalidateAll } from '$app/navigation';
  import { createVersionsCalls } from './client';
  import VersionsPage from './VersionsPage.svelte';
  import type { ActionAnswer, VersionsCalls } from './types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const base = createVersionsCalls({
    project: untrack(() => data.project),
    fetch: (input, init) => fetch(input, init),
  });
  const changed = async (call: Promise<ActionAnswer>): Promise<ActionAnswer> => {
    const answer = await call;
    if (answer.ok) await invalidateAll();
    return answer;
  };
  const calls: VersionsCalls = {
    rollback: (version) => changed(base.rollback(version)),
    compare: (from, to) => base.compare(from, to),
    discard: () => changed(base.discard()),
    upgrade: (overlay, mappings) => changed(base.upgrade(overlay, mappings)),
    movePlan: (version, locale) => base.movePlan(version, locale),
    movePins: (version, mappings, locale) => base.movePins(version, mappings, locale),
  };
</script>

<VersionsPage locale={data.locale} {data} {calls} pinned={data.pinned} onmoved={() => void invalidateAll()} />
