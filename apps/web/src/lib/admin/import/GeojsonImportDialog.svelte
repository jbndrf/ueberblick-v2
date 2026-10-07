<script lang="ts">
  // 'GeoJSON importieren' (v3 `geojson-import/geojson-import-dialog.svelte`, opened from the Objektarten "+" menu): the
  // steps Hochladen, Prüfen and Fortschritt in one dialog (`max-h-[85vh] sm:max-w-2xl`, v3's size). v3 posted the
  // wizard's result to a route that created the collection and wrote the features. Here the new Objektart goes into the
  // draft (with the task that creates it), 'Veröffentlichen und importieren' publishes the draft (nothing is live before
  // the first publish, owner A4) and WP-363's import job writes the features as runs (R3).
  import { untrack } from 'svelte';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import {
    geometryKeyOf,
    stringifyForText,
    type FeatureCollectionLike,
    type ImportColumnType,
    type Survey,
  } from '@ueberblick/core';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { createTypeEditor } from '../../../routes/(admin)/admin/shell/sidebar-types-client';
  import { createPublishClient } from '../draft/publish-client';
  import { createDeployClient } from '../deploy/deploy-client';
  import { readGeojson, type PropertyRow } from './geojson-read';
  import GeojsonReviewStep from './GeojsonReviewStep.svelte';
  import { importedTypeEdit } from './geojson-type';
  import type { T } from './i18n';
  import { createImportClient, type ImportFailure, type JobView } from './import-client';
  import type { MappingBody } from './mapping';
  import ProgressStep from './ProgressStep.svelte';
  import { deployDraft, publishFailure, type PublishFailure } from './publish-failure';
  import UploadStep from './UploadStep.svelte';

  let {
    open = $bindable(false),
    locale,
    project,
    onpublished,
    ondone,
    fetchFn = fetch,
  }: {
    open?: boolean;
    locale: Locale;
    project: string;
    /** The draft went live (the shell's bar and the sidebar re-read). */
    onpublished: () => void | Promise<void>;
    /** The admin left a finished import ('Zu den Objekten'): `typeKey` is the new Objektart. */
    ondone: (typeKey: string) => void;
    fetchFn?: typeof fetch;
  } = $props();

  const t: T = (key, values = {}) => adminMessage(locale, key, values);
  const editor = $derived(createTypeEditor({ project, fetch: fetchFn }));
  const publisher = $derived(createPublishClient({ project, fetch: fetchFn }));
  const deployer = $derived(createDeployClient({ project, fetch: fetchFn }));
  const imports = $derived(createImportClient({ project, fetch: fetchFn }));

  type Step = 'upload' | 'review' | 'progress';
  let step = $state<Step>('upload');
  let readError = $state<AdminKey | null>(null);
  let file = $state<File | null>(null);
  let survey = $state<Survey | null>(null);
  let collection = $state<FeatureCollectionLike | null>(null);
  let name = $state('');
  let rows = $state<PropertyRow[]>([]);
  let busy = $state(false);
  let failure = $state<PublishFailure | null>(null);
  /** The type is in the draft already: a retry after a publish problem must not add it twice. */
  let created = $state<{ typeKey: string; mapping: MappingBody } | null>(null);
  let job = $state<JobView | null>(null);
  let runFailure = $state<ImportFailure | null>(null);
  let running = $state(false);

  function reset(): void {
    step = 'upload';
    readError = null;
    file = null;
    survey = null;
    collection = null;
    name = '';
    rows = [];
    busy = false;
    failure = null;
    created = null;
    job = null;
    runFailure = null;
    running = false;
  }

  async function chooseFile(chosen: File): Promise<void> {
    readError = null;
    const read = await readGeojson(chosen);
    if (!read.ok) {
      readError = read.error;
      return;
    }
    file = chosen;
    survey = read.survey;
    collection = read.collection;
    name = read.name;
    rows = read.survey.columns.map((c) => ({ name: c.name, inferred: c.inferred, selected: c.inferred }));
    step = 'review';
  }

  /** What the import reads: the file, with the values of text columns written as text when a column was overridden. */
  function importFile(): File | null {
    if (file === null || collection === null) return null;
    const types: Record<string, ImportColumnType> = {};
    for (const r of rows) types[r.name] = r.selected;
    const text = stringifyForText(collection, types);
    return text === collection ? file : new File([JSON.stringify(text)], file.name, { type: file.type });
  }

  async function start(): Promise<void> {
    const upload = importFile();
    if (upload === null || survey === null || name.trim() === '') return;
    busy = true;
    failure = null;
    if (created === null) {
      const edit = await editor.apply(
        importedTypeEdit({
          name: name.trim(),
          geometry: geometryKeyOf(survey.geometryKinds),
          columns: rows.map((r) => ({ name: r.name, type: r.selected })),
        }),
      );
      if (!edit.ok) {
        busy = false;
        failure = { text: t('import_geojson_draft_failed') };
        return;
      }
      created = edit.result;
    }
    const status = await publisher.status();
    const result = await deployDraft(deployer, status);
    if (result.kind !== 'deployed') {
      busy = false;
      failure = publishFailure(locale, result, project, created.typeKey);
      return;
    }
    await onpublished();
    step = 'progress';
    running = true;
    // A fresh type with a few unreadable features is better off partly imported and reported than empty and published.
    const out = await imports.run(
      upload,
      created.mapping,
      { mode: 'skip', replace: false },
      (p) => (job = p),
    );
    running = false;
    busy = false;
    if (out.kind === 'error') runFailure = out;
    else {
      job = out.job;
      if (out.job.state === 'done' && out.job.outcome === 'accepted')
        toast.success(t('import_geojson_done_ok', { count: out.job.imported ?? 0 }));
    }
  }

  const accepted = $derived(job?.state === 'done' && job.outcome === 'accepted');

  function close(): void {
    const typeKey = created?.typeKey;
    open = false;
    if (accepted && typeKey !== undefined) ondone(typeKey);
  }

  // A fresh wizard each time it opens; closing while the job runs is refused (the job would go on unseen).
  $effect(() => {
    if (open) untrack(reset);
  });
</script>

<Dialog.Root
  bind:open
  onOpenChange={(isOpen) => {
    if (!isOpen && running) open = true;
  }}
>
  <Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="geojson-dialog">
    <Dialog.Header>
      <Dialog.Title>{t('import_geojson_title')}</Dialog.Title>
      <Dialog.Description>{t('import_geojson_description')}</Dialog.Description>
    </Dialog.Header>

    {#if step === 'upload'}
      <UploadStep
        {t}
        error={readError}
        labelKey="import_geojson_file_label"
        accept=".geojson,.json,application/geo+json,application/json"
        inputId="geojson-file"
        testid="geojson-file"
        onfile={(f) => void chooseFile(f)}
        oncancel={() => (open = false)}
      />
    {:else if step === 'review' && survey}
      <GeojsonReviewStep
        {t}
        bind:name
        bind:rows
        featureCount={survey.featureCount}
        kinds={survey.geometryKinds}
        {busy}
        locked={created !== null}
        {failure}
        onback={() => reset()}
        onimport={() => void start()}
      />
    {:else if step === 'progress'}
      <ProgressStep
        {t}
        {job}
        failure={runFailure}
        mode="skip"
        doneKey="import_geojson_done_ok"
        failedKey="import_geojson_failed"
        onclose={close}
      />
    {/if}
  </Dialog.Content>
</Dialog.Root>
