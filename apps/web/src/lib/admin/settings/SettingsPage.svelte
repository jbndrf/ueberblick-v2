<script lang="ts">
  // The Projekteinstellungen page (v3 `settings/+page.svelte:178-243`): the heading, the section sidebar (a column above
  // the content on a phone, beside it from `md`, sticky) and the one section that is selected. The sections come from
  // the registry (`sections.ts`); the route owns `?section=` and passes the current id and `onselect`.
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { SettingsApi } from './api';
  import SettingsSidebar from './SettingsSidebar.svelte';
  import type { SidebarGroup } from './sidebar-types';
  import { SETTINGS_GROUPS, SETTINGS_SECTIONS, sectionFor, type SettingsSectionDef } from './sections';
  import type { SettingsPageData } from './types';

  let {
    data,
    locale,
    project,
    api,
    reload,
    current,
    onselect,
    sections = SETTINGS_SECTIONS,
  }: {
    data: SettingsPageData;
    locale: Locale;
    project: string;
    api: SettingsApi;
    reload: () => Promise<void>;
    /** The `?section=` value, or null. */
    current: string | null;
    onselect: (id: string) => void;
    sections?: readonly SettingsSectionDef[];
  } = $props();

  const active = $derived(sectionFor(current, sections));
  const groups = $derived<SidebarGroup[]>(
    SETTINGS_GROUPS.flatMap((group) => {
      const items = sections
        .filter((s) => s.group === group.key)
        .map((s) => ({
          id: s.id,
          label: adminMessage(locale, s.label),
          icon: s.icon,
          ...(s.status ? { status: s.status(data) } : {}),
          ...(s.tone ? { tone: s.tone } : {}),
        }));
      return items.length === 0 ? [] : [{ caption: adminMessage(locale, group.label), items }];
    }),
  );
  const Section = $derived(active?.component);
</script>

<div class="flex w-full min-w-0 flex-col gap-6">
  <h1 class="text-3xl font-bold tracking-tight">{adminMessage(locale, 'nav_project_settings')}</h1>

  <div class="flex flex-col gap-8 md:flex-row md:items-start md:gap-10">
    <aside class="md:sticky md:top-6 md:shrink-0 md:self-start">
      <SettingsSidebar
        {groups}
        current={active?.id ?? ''}
        label={adminMessage(locale, 'settings_nav_aria')}
        onSelect={onselect}
      />
    </aside>

    <div class="min-w-0 flex-1">
      {#if Section}
        <Section {data} {locale} {project} {api} {reload} />
      {/if}
    </div>
  </div>
</div>
