<script lang="ts">
  // v3's SVG icon designer (`lib/components/admin/svg-icon-designer.svelte`): a template or a custom SVG (upload or paste),
  // one colour, a size, an optional badge, a live preview, Abbrechen and "Icon speichern". Differences, all forced by the
  // engine: the SVG is checked by core's one gate (`checkLook`, the check `compile()` runs), a template that matches a
  // registry key is saved as `{ key }`, v3's border, background, shadow and pin shape are gone (v3 always saved defaults,
  // B-018), the preview is an `<img>` (no markup is inserted), and a badge is composed into a template only (v3 embedded
  // a custom SVG as `<image>`, which the gate refuses).
  import { untrack } from 'svelte';
  import FileCode from '@lucide/svelte/icons/file-code';
  import Shapes from '@lucide/svelte/icons/shapes';
  import Upload from '@lucide/svelte/icons/upload';
  import { MARKER_ICON_SIZE } from '@ueberblick/core';
  import { markerSvg, markerSvgUrl } from '@ueberblick/ui';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Textarea } from '@ueberblick/ui/components/ui/textarea';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { IconBadge, IconLook, IconShape, IconTemplate, IconsKit } from './types';

  let {
    locale,
    kit,
    initial,
    onsave,
    oncancel,
  }: {
    locale: Locale;
    /** The builder's icon functions (the route hands them in). */
    kit: IconsKit;
    /** The look being edited; undefined starts empty. */
    initial?: IconLook | undefined;
    /** Resolves with the refusal text, or null when it worked (the dialog returns to the overview). */
    onsave: (look: IconLook) => Promise<string | null>;
    oncancel: () => void;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  const TEMPLATE_LABEL = (id: string): AdminKey => `icons_tpl_${id}` as AdminKey;
  const BADGE_LABEL = (id: string): AdminKey => `icons_badge_${id}` as AdminKey;

  // The editor is mounted per edit, so the look it starts from is read once.
  const seed = untrack(() => initial);
  const start = seed?.icon;
  const startTemplate: IconTemplate | null =
    start !== undefined && 'key' in start
      ? (untrack(() => kit.templates.find((x) => x.registryKey === start.key)) ?? null)
      : null;

  // A registry icon set by a project template has no designer template: its drawing, from the resolver the map uses
  // (`markerSvg`), is the code to edit, so the admin sees and can change what the map shows (R1, no second lookup).
  const keySvg =
    start !== undefined && 'key' in start
      ? markerSvg({
          color: seed?.color ?? '#2563eb',
          icon: { key: start.key },
          size: start.size ?? MARKER_ICON_SIZE.default,
        })
      : '';
  let tab = $state<'templates' | 'custom'>(
    start !== undefined && ('svg' in start || startTemplate === null) ? 'custom' : 'templates',
  );
  let template = $state<IconTemplate | null>(startTemplate);
  /** A registry icon v3 had no template for (set elsewhere, for example by a project template): kept until another is chosen. */
  let kept = $state<IconShape | null>(
    start !== undefined && 'key' in start && startTemplate === null ? start : null,
  );
  let customSvg = $state(start !== undefined && 'svg' in start ? start.svg : keySvg);
  let filename = $state('');
  let color = $state(seed?.color ?? '#2563eb');
  let size = $state<number>(start?.size ?? MARKER_ICON_SIZE.default);
  let badge = $state<IconBadge | null>(null);
  let refusal = $state<string | null>(null);
  let busy = $state(false);
  let fileInput = $state<HTMLInputElement>();
  const uid = $props.id();

  const customProblem = $derived.by(() => {
    const text = customSvg.trim();
    if (tab !== 'custom' || text === '') return null;
    const bad = kit.checkLook({ icon: { svg: text } });
    return bad?.detail ?? null;
  });

  /** The icon the editor would save, or null while there is none (or the custom SVG is invalid). */
  const icon = $derived.by((): IconShape | null => {
    const withSize = size === MARKER_ICON_SIZE.default ? {} : { size };
    if (tab === 'templates') {
      if (template !== null) return kit.templateIcon({ template, color, size, badge: badge ?? undefined });
      return kept === null ? null : { ...kept, ...withSize };
    }
    const text = customSvg.trim();
    return text === '' || customProblem !== null ? null : { svg: text, ...withSize };
  });
  const previewUrl = $derived(
    icon === null || '$ref' in icon
      ? null
      : markerSvgUrl({ color, icon, size: Number.isFinite(size) ? size : MARKER_ICON_SIZE.default }, 96),
  );

  function pick(next: IconTemplate): void {
    template = next;
    kept = null;
  }

  async function upload(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file === undefined) return;
    if (!file.name.toLowerCase().endsWith('.svg')) {
      refusal = t('icons_upload_svg_only');
      return;
    }
    const text = (await file.text()).trim();
    const bad = kit.checkLook({ icon: { svg: text } });
    if (bad !== null) {
      refusal = `${t('icons_invalid_svg')}: ${bad.detail ?? ''}`;
      return;
    }
    customSvg = text;
    filename = file.name;
    refusal = null;
  }

  async function save(): Promise<void> {
    if (icon === null || busy) return;
    busy = true;
    refusal = await onsave({ color, icon });
    busy = false;
  }
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4">
  <div>
    <h2 class="text-xl font-semibold">{t('icons_designer_title')}</h2>
    <p class="text-sm text-muted-foreground">{t('icons_designer_subtitle')}</p>
  </div>

  <div class="grid min-h-0 flex-1 gap-6 overflow-y-auto sm:grid-cols-[1fr_12rem]">
    <div class="flex min-w-0 flex-col gap-4">
      <div class="flex gap-2">
        <Button
          variant={tab === 'templates' ? 'default' : 'outline'}
          size="sm"
          data-testid="tab-templates"
          onclick={() => (tab = 'templates')}
        >
          <Shapes class="mr-2 h-4 w-4" />
          {t('icons_tab_templates')}
        </Button>
        <Button
          variant={tab === 'custom' ? 'default' : 'outline'}
          size="sm"
          data-testid="tab-custom"
          onclick={() => (tab = 'custom')}
        >
          <FileCode class="mr-2 h-4 w-4" />
          {t('icons_tab_custom')}
        </Button>
      </div>

      {#if tab === 'templates'}
        <div class="space-y-2">
          <Label>{t('icons_choose')}</Label>
          <div class="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {#each kit.templates as tpl (tpl.id)}
              <button
                type="button"
                data-template={tpl.id}
                aria-pressed={template?.id === tpl.id}
                onclick={() => pick(tpl)}
                class="flex flex-col items-center gap-1 rounded-lg border-2 p-2.5 transition-all hover:scale-105 {template?.id ===
                tpl.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50'}"
                title={t(TEMPLATE_LABEL(tpl.id))}
              >
                <svg viewBox="0 0 24 24" width="28" height="28" class="text-foreground" aria-hidden="true">
                  {@html tpl.path}
                </svg>
                <span class="text-[10px] text-muted-foreground">{t(TEMPLATE_LABEL(tpl.id))}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <div class="space-y-3">
          <div class="flex gap-2">
            <input
              bind:this={fileInput}
              type="file"
              accept=".svg"
              data-testid="svg-file"
              onchange={upload}
              class="hidden"
            />
            <Button variant="outline" size="sm" onclick={() => fileInput?.click()}>
              <Upload class="mr-2 h-4 w-4" />
              {t('icons_upload')}
            </Button>
            {#if filename}
              <span class="flex items-center text-xs text-muted-foreground">{filename}</span>
            {/if}
          </div>
          <Textarea
            bind:value={customSvg}
            oninput={() => (filename = '')}
            placeholder={t('icons_paste_placeholder')}
            data-testid="svg-paste"
            aria-invalid={customProblem !== null ? 'true' : undefined}
            class="font-mono text-xs"
            rows={6}
          />
          {#if customProblem !== null}
            <p role="alert" data-testid="svg-problem" class="text-sm text-destructive">
              {t('icons_invalid_svg')}: {customProblem}
            </p>
          {/if}
        </div>
      {/if}

      <div class="space-y-2">
        <Label for="{uid}-color">{t('icons_color')}</Label>
        <div class="flex items-center gap-2">
          <input
            id="{uid}-color"
            type="color"
            bind:value={color}
            class="h-9 w-12 cursor-pointer rounded border border-border"
          />
          <Input
            type="text"
            bind:value={color}
            aria-label={t('icons_color')}
            class="h-9 w-28 font-mono text-xs"
          />
        </div>
      </div>

      <div class="space-y-2">
        <Label for="{uid}-size">{t('icons_size')}</Label>
        <Input
          id="{uid}-size"
          type="number"
          bind:value={size}
          min={MARKER_ICON_SIZE.min}
          max={MARKER_ICON_SIZE.max}
          class="h-9 w-24"
        />
      </div>

      {#if tab === 'templates'}
        <div class="space-y-2">
          <Label>{t('icons_badge')}</Label>
          <div class="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={badge === null}
              onclick={() => (badge = null)}
              class="flex h-9 items-center gap-1.5 rounded-md border-2 px-2.5 text-xs font-medium transition-all {badge ===
              null
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:border-primary/50'}"
            >
              {t('icons_badge_none')}
            </button>
            {#each kit.badges as b (b.id)}
              <button
                type="button"
                aria-pressed={badge?.id === b.id}
                onclick={() => (badge = badge?.id === b.id ? null : b)}
                class="flex h-9 items-center gap-1.5 rounded-md border-2 px-2.5 text-xs font-medium transition-all {badge?.id ===
                b.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50'}"
                title={t(BADGE_LABEL(b.id))}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" style="color: {b.color}" aria-hidden="true">
                  {@html b.path}
                </svg>
                {t(BADGE_LABEL(b.id))}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="flex flex-col gap-3">
      <Label>{t('icons_preview')}</Label>
      <div
        class="flex min-h-40 flex-1 items-center justify-center rounded-lg border-2 border-dashed bg-muted/20 p-4"
      >
        {#if previewUrl !== null}
          <img data-testid="icon-preview" src={previewUrl} alt={t('icons_preview')} />
        {:else}
          <p class="text-center text-xs text-muted-foreground">{t('icons_preview_empty')}</p>
        {/if}
      </div>
    </div>
  </div>

  {#if refusal}
    <p role="alert" data-testid="icon-refusal" class="text-sm text-destructive">{refusal}</p>
  {/if}

  <div class="flex justify-end gap-3 border-t pt-3">
    <Button variant="outline" onclick={oncancel}>{t('icons_cancel')}</Button>
    <Button onclick={() => void save()} disabled={icon === null || busy}>{t('icons_save')}</Button>
  </div>
</div>
