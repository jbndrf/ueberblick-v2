<script lang="ts">
  // 'CSV importieren' (v3 `csv-import/csv-import-dialog.svelte`, opened from the data page header): the four steps
  // Hochladen, Zuordnen, Vorschau and Fortschritt, as one dialog (`max-h-[85vh] sm:max-w-2xl`, v3's size). It only builds
  // the mapping and asks WP-363's endpoints: the dry run is step 3's content, the job's progress is step 4's (R1).
  // A type that was never published ends with 'Veröffentlichen und importieren' (owner A4).
  import { untrack } from 'svelte';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { createPublishClient } from '../draft/publish-client';
  import { createDeployClient } from '../deploy/deploy-client';
  import type { DeployAnswer } from '../deploy/types';
  import { scanCsv, type CsvScan } from './csv-scan';
  import type { T } from './i18n';
  import { createImportClient, type ImportFailure, type JobView, type PlanResult } from './import-client';
  import { autoMap, buildMapping, targetsOf, type MappingState } from './mapping';
  import MapStep from './MapStep.svelte';
  import PreviewStep from './PreviewStep.svelte';
  import ProgressStep from './ProgressStep.svelte';
  import { deployDraft, publishFailure, type PublishFailure } from './publish-failure';
  import type { ImportSetup } from './setup';
  import UploadStep from './UploadStep.svelte';

  let {
    open = $bindable(false),
    locale,
    project,
    type,
    setup,
    published,
    onpublished,
    ondone,
    fetchFn = fetch,
  }: {
    open?: boolean;
    locale: Locale;
    project: string;
    /** The Objektart's key, for the builder link of a publish problem. */
    type: string;
    setup: ImportSetup | null;
    /** The type is in the deployed version; false: the import follows 'Veröffentlichen' (A4). */
    published: boolean;
    /** The draft went live (the shell's bar and the page's data re-read). */
    onpublished: () => void | Promise<void>;
    /** An import finished and wrote Objekte: the table reloads. */
    ondone: () => void;
    fetchFn?: typeof fetch;
  } = $props();

  const t: T = (key, values = {}) => adminMessage(locale, key, values);
  const imports = $derived(createImportClient({ project, fetch: fetchFn }));
  const publisher = $derived(createPublishClient({ project, fetch: fetchFn }));
  /** Only a never-published project is deployed from here: it has no running Objekte, so no value move (owner A4). */
  const deployer = $derived(createDeployClient({ project, fetch: fetchFn }));

  type Step = 'upload' | 'map' | 'preview' | 'progress';
  let step = $state<Step>('upload');
  let readError = $state<'import_read_error' | null>(null);
  let file = $state<File | null>(null);
  let scan = $state<CsvScan | null>(null);
  let mapping = $state<MappingState>({ columns: {}, stage: '', constants: [], crs: 'EPSG:4326' });
  let plan = $state<PlanResult | null>(null);
  let checking = $state(false);
  let replace = $state(false);
  let mode = $state<'atomic' | 'skip'>('atomic');
  let busy = $state(false);
  let wentLive = $state(false);
  let failure = $state<PublishFailure | null>(null);
  let job = $state<JobView | null>(null);
  let runFailure = $state<ImportFailure | null>(null);
  let running = $state(false);

  const isPublished = $derived(published || wentLive);
  const targets = $derived(setup ? targetsOf(setup, { lon: t('import_lon'), lat: t('import_lat') }) : []);
  const labels = $derived.by(() => {
    const out: Record<string, string> = {};
    if (setup === null) return out;
    for (const f of setup.fields) out[f.key] = f.label;
    for (const c of setup.constants) out[c.key] = c.label;
    if (setup.stage) out[setup.stage.property] = setup.stage.label;
    // The geometry's column head: the data table's 'Standort'.
    if (setup.geometry) out[setup.geometry.field] = adminMessage(locale, 'data_col_location');
    return out;
  });
  const mappingBody = $derived(setup && scan ? buildMapping(setup, mapping, scan.delimiter) : null);

  function reset(): void {
    step = 'upload';
    readError = null;
    file = null;
    scan = null;
    mapping = { columns: {}, stage: setup?.stage?.start ?? '', constants: [], crs: 'EPSG:4326' };
    plan = null;
    checking = false;
    replace = false;
    mode = 'atomic';
    busy = false;
    failure = null;
    job = null;
    runFailure = null;
    running = false;
  }

  async function chooseFile(chosen: File): Promise<void> {
    readError = null;
    const next = scanCsv(await chosen.text());
    if (next.headers.length === 0) {
      readError = 'import_read_error';
      return;
    }
    file = chosen;
    scan = next;
    mapping = { ...mapping, columns: autoMap(next.headers, targets) };
    step = 'map';
  }

  /** Step 2 -> 3: the dry run (a project with nothing deployed has none: the preview explains A4). */
  async function toPreview(): Promise<void> {
    if (file === null || mappingBody === null) return;
    failure = null;
    plan = null;
    if (isPublished) {
      checking = true;
      plan = await imports.plan(file, mappingBody);
      checking = false;
    }
    step = 'preview';
  }

  async function start(): Promise<void> {
    if (file === null || mappingBody === null) return;
    busy = true;
    failure = null;
    if (!isPublished) {
      const status = await publisher.status();
      const result: DeployAnswer =
        status?.neverPublished === true ? await deployDraft(deployer, status) : { kind: 'failed' };
      if (result.kind !== 'deployed') {
        busy = false;
        failure = publishFailure(locale, result, project, type);
        return;
      }
      wentLive = true;
      await onpublished();
    }
    step = 'progress';
    running = true;
    job = null;
    runFailure = null;
    const out = await imports.run(
      file,
      mappingBody,
      { mode: replace ? 'atomic' : mode, replace },
      (p) => (job = p),
    );
    running = false;
    busy = false;
    if (out.kind === 'error') runFailure = out;
    else {
      job = out.job;
      if (out.job.state === 'done' && out.job.outcome === 'accepted') ondone();
    }
  }

  function close(): void {
    open = false;
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
  <Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="csv-import">
    <Dialog.Header>
      <Dialog.Title>{t('import_title')}</Dialog.Title>
      <Dialog.Description>{t('import_description')}</Dialog.Description>
    </Dialog.Header>

    {#if setup === null}
      <p class="py-4 text-sm text-muted-foreground" data-testid="import-no-task">{t('import_no_task')}</p>
    {:else if step === 'upload'}
      <UploadStep
        {t}
        error={readError}
        labelKey="import_file_label"
        accept=".csv,text/csv"
        inputId="csv-file"
        testid="csv-file"
        onfile={(f) => void chooseFile(f)}
        oncancel={close}
      />
    {:else if step === 'map' && scan}
      <MapStep
        {t}
        {scan}
        {setup}
        {targets}
        bind:mapping
        {checking}
        onback={() => reset()}
        onnext={() => void toPreview()}
      />
    {:else if step === 'preview' && scan}
      <PreviewStep
        {t}
        {plan}
        published={isPublished}
        rowCount={scan.rowCount}
        {labels}
        bind:replace
        bind:mode
        {busy}
        {failure}
        onback={() => (step = 'map')}
        onimport={() => void start()}
      />
    {:else if step === 'progress'}
      <ProgressStep {t} {job} failure={runFailure} mode={replace ? 'atomic' : mode} onclose={close} />
    {/if}
  </Dialog.Content>
</Dialog.Root>
