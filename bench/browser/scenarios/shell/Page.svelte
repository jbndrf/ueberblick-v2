<script lang="ts">
  import type { TemplateFile } from '@ueberblick/core';
  import AppShell from '../../../../packages/ui/src/shell/AppShell.svelte';
  import { deriveShellModel } from '../../../../packages/ui/src/shell/model';
  import type { StatusModel } from '../../../../packages/ui/src/shell/contract';

  const file = {
    schema: '1',
    template: { key: 't', version: '1.0.0' },
    roles: {
      worker: {
        label: 'Worker',
        app: { home: 'mine', views: { mine: {}, all: {} }, tools: { photo: {} }, shortcuts: { inspect: {} } },
      },
    },
    views: { all: { label: 'All trees' }, mine: { label: 'Mine' } },
    tools: { photo: {} },
    tasks: {
      inspect: { label: 'Inspection', on: { create: 'tree' } },
      report: { label: 'Report', on: { create: 'defect' } },
    },
  } as unknown as TemplateFile;

  const model = deriveShellModel({ file, roleKey: 'worker', locale: 'en' });
  const status: StatusModel = {
    online: true,
    lastSyncedAt: '2026-09-29T08:00:00Z',
    pending: 0,
    oldestPendingAge: null,
    refused: [],
    storage: 'ok',
  };
</script>

{#snippet map({ viewKey }: { viewKey: string | null })}<p>map: {viewKey}</p>{/snippet}
{#snippet taskSheet({ taskKey }: { taskKey: string })}<p>task: {taskKey}</p>{/snippet}

<AppShell {model} {status} onexport={() => undefined} {map} {taskSheet} />
