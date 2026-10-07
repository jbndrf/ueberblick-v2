<script lang="ts">
  // The page header (v3 `data-viewer-header.svelte` with the page's actions, `+page.svelte:869-1055`): the Objektart's name and
  // description (click to edit: pencil on hover, check and cross, Enter saves, Escape cancels), "Sichtbar für Rollen" (a
  // multi-select, empty means every role), the type and geometry pills and "Private Einträge" (`HeaderPills`), and the action
  // row: "CSV importieren" (v3 `+page.svelte:996-999`, S3-22), "Icons" (`:1001`, S3-25), "Builder", "Aktualisieren" and the ⋮ menu
  // (`DataMenu`, WP-419: Duplizieren, Aus Projekt importieren, Objektart löschen). Without `header` (a page that has no draft to edit) it shows the name and the description only.
  // The name, description and roles are the shared `TypeHeaderFields` block (also the table page's). Each edit is one call the route applies to the draft (`HeaderCall`); the shell's publish bar follows.
  import Hammer from '@lucide/svelte/icons/hammer';
  import Palette from '@lucide/svelte/icons/palette';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Upload from '@lucide/svelte/icons/upload';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import DataMenu from './DataMenu.svelte';
  import TypeHeaderFields from './TypeHeaderFields.svelte';
  import HeaderPills from './HeaderPills.svelte';
  import type { HeaderCall, HeaderResult, HeaderState } from './header-types';

  let {
    name,
    description = '',
    builderHref,
    builderLabel,
    refreshLabel,
    onRefresh,
    iconsLabel,
    onIcons,
    importLabel,
    onImport,
    header,
    locale = 'de',
    onCall,
    menu,
  }: {
    name: string;
    description?: string;
    builderHref: string;
    builderLabel: string;
    refreshLabel: string;
    onRefresh: () => void;
    /** "Icons": absent while the Objektart has no project file entry to design icons for. */
    iconsLabel?: string;
    onIcons?: (() => void) | undefined;
    importLabel: string;
    onImport: () => void;
    /** What the header edits; absent: no editing. */
    header?: HeaderState | undefined;
    locale?: Locale;
    /** One edit; the route saves it to the draft and answers with the refusal, if any. */
    onCall?: ((call: HeaderCall) => Promise<HeaderResult>) | undefined;
    /** The ⋮ menu's actions; absent: no menu (the page has no draft entry to copy or remove). */
    menu?: { busy: boolean; onDuplicate: () => void; onImport: () => void; onDelete: () => void } | undefined;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  const editable = $derived(header !== undefined && onCall !== undefined);
  let shapeChanged = $state(false);

  const send = async (call: HeaderCall): Promise<HeaderResult> =>
    onCall === undefined ? { ok: true } : onCall(call);
</script>

<TypeHeaderFields
  {locale}
  prefix="data"
  {name}
  {description}
  audience={header?.audience ?? { kind: 'all' }}
  roles={header?.roles ?? []}
  {editable}
  onName={(value) => send({ action: 'name', value })}
  onDescription={(value) => send({ action: 'description', value })}
  onRoles={(roles) => send({ action: 'roles', roles })}
>
  {#snippet actions()}
    {#if header && editable}
      <HeaderPills {locale} {header} onCall={send} onShape={() => (shapeChanged = true)} />
    {/if}
    <Button variant="outline" size="sm" onclick={onImport} data-testid="csv-import-button">
      <Upload class="mr-2 h-4 w-4" />
      {importLabel}
    </Button>
    {#if onIcons}
      <Button variant="outline" size="sm" data-testid="data-icons" onclick={onIcons}>
        <Palette class="mr-2 h-4 w-4" />
        {iconsLabel}
      </Button>
    {/if}
    <Button variant="outline" size="sm" href={builderHref}>
      <Hammer class="mr-2 h-4 w-4" />
      {builderLabel}
    </Button>
    <Button variant="outline" size="sm" onclick={onRefresh}>
      <RefreshCw class="mr-2 h-4 w-4" />
      {refreshLabel}
    </Button>
    {#if menu}
      <DataMenu {locale} {...menu} />
    {/if}
  {/snippet}
  {#snippet notes()}
    {#if header && editable && header.private === 'custom'}
      <p class="text-xs text-muted-foreground" role="status" data-testid="data-private-custom">
        {t('data_private_custom', { when: header.privateWhen ?? '' })}
      </p>
    {/if}
    {#if header && editable && header.shape && shapeChanged && header.featureCount > 0}
      <p class="text-xs text-muted-foreground" role="status" data-testid="data-shape-note">
        {t('data_shape_note', { count: header.featureCount })}
      </p>
    {/if}
  {/snippet}
</TypeHeaderFields>
