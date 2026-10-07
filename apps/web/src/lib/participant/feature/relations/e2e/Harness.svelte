<script lang="ts">
  // The relation path, the relation level and the run notices in the real module shell, over the small world of
  // `fixtures.ts` (what the host does with the device, minus the device). Test fixture only.
  // `?id=` picks the open feature (b1 default), `?group=` opens a relation level, `?refused=0` has no run to report.
  import { ModuleShell } from '@ueberblick/ui';
  import type { FeatureId, Instant, RunId, Key } from '@ueberblick/core/model';
  import type { QueueStatus, StoredRun } from '@ueberblick/client';
  import FeatureNotices from '../../notices/FeatureNotices.svelte';
  import { createRelationNav, focusOf } from '../nav';
  import { deps, world, type Node } from '../fixtures';
  import RelationList from '../RelationList.svelte';
  import RelationPath from '../RelationPath.svelte';

  const WORLD: Record<string, Node> = {
    g1: { type: 'gebiet', label: 'Nord' },
    g2: { type: 'gebiet', label: 'Süd' },
    b1: {
      type: 'baum',
      label: 'Eiche',
      stage: 'neu',
      parents: [
        ['gebiet', 'g1'],
        ['gebiet', 'g2'],
      ],
      tasks: ['massnahme_anlegen'],
    },
    b2: { type: 'baum', label: 'Linde', stage: 'fertig', parents: [['gebiet', 'g1']] },
    b3: { type: 'baum', label: 'Ahorn', stage: 'neu', parents: [['gebiet', 'g1']] },
    m1: {
      type: 'massnahme',
      label: 'Schnitt',
      stage: 'offen',
      parents: [['baum', 'b1']],
      tasks: ['massnahme_erledigen'],
    },
  };
  const params = new URLSearchParams(location.search);
  let id = $state((params.get('id') ?? 'b1') as FeatureId);
  let openGroup: string | undefined = $state(params.get('group') ?? undefined);
  let picked: number | undefined = $state();
  const NOW = '2026-10-01T12:00:00Z' as Instant;

  const nav = createRelationNav(deps(world(WORLD).source));
  const chains = $derived(nav.chains(id));
  const chainIndex = $derived(picked ?? 0);
  const title = $derived(nav.summary(id)?.typeLabel ?? '');

  // What the host hands the map (`isolate`): recorded on the page so the e2e can read it.
  const focus = $derived(focusOf(nav, id, openGroup, chains[chainIndex]));
  $effect(() => {
    (window as unknown as { __isolated: unknown }).__isolated = focus === null ? null : [...focus];
  });

  function go(next: FeatureId, group?: string): void {
    id = next;
    openGroup = group;
    picked = undefined;
  }

  const run = (n: number, state: StoredRun['state']): StoredRun =>
    ({
      order: n,
      blobs: [],
      blobMimes: {},
      state,
      ...(state === 'refused' ? { refusal: { code: 'constraint_failed', message: 'Zu hoch' } } : {}),
      run: {
        id: `r${n}` as RunId,
        task: 'kontrolle' as Key,
        actor: { id: 'anna', kind: 'participant', roles: [] },
        configVersion: 1,
        featureId: 'b1' as FeatureId,
        input: {},
      },
    }) as unknown as StoredRun;
  let runs = $state.raw<StoredRun[]>(
    params.get('refused') === '0' ? [] : [run(1, 'refused'), run(2, 'queued')],
  );
  const listeners = new Set<(status: QueueStatus) => void>();
  const status: QueueStatus = {
    pending: 0,
    awaitingPull: 0,
    oldestPendingAgeMs: undefined,
    sending: undefined,
    refused: [],
    review: [],
    hold: undefined,
    awaitingConfig: [],
    retryInMs: undefined,
    serverProtocol: undefined,
    unpredicted: [],
  };
  const ring = (): void => listeners.forEach((l) => l(status));
  const device = {
    store: { readRuns: async () => runs },
    queue: {
      status: () => status,
      subscribe: (l: (status: QueueStatus) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      discard: async (rid: RunId) => {
        runs = runs.filter((r) => r.run.id !== rid);
        ring();
      },
      resubmit: async () => ({ ok: true }) as never,
    },
  };
</script>

<ModuleShell
  open={true}
  {title}
  toggleLabel="Objekt vergrößern oder verkleinern"
  closeLabel="Schließen"
  testid="harness-sheet"
>
  {#snippet titleContent()}
    <RelationPath
      {nav}
      {id}
      {title}
      locale="de"
      {openGroup}
      {chains}
      {chainIndex}
      openWork={(p, g) => nav.openWork(p, g)}
      onselectchain={(i) => (picked = i)}
      onopen={(next) => go(next)}
      onopengroup={(parent, group) => (parent === id ? (openGroup = group) : go(parent, group))}
      onclosegroup={() => (openGroup = undefined)}
      oncreate={() => undefined}
    />
  {/snippet}
  <div class="p-4">
    {#if openGroup !== undefined}
      <RelationList
        {nav}
        parent={id}
        group={openGroup}
        locale="de"
        now={NOW}
        create={nav.offer(id, openGroup)}
        leads={(rid) => nav.leadsToOpenWork(rid)}
        oncreate={() => undefined}
        onopen={(next) => go(next)}
      />
    {:else}
      <FeatureNotices
        {device}
        featureId={id}
        locale="de"
        taskLabel={(k) => (k === 'kontrolle' ? 'Kontrolle' : k)}
      />
      <p class="text-sm text-muted-foreground">Aktionen und Tabs</p>
    {/if}
  </div>
</ModuleShell>
