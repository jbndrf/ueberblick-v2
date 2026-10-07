/**
 * The settings sections as data (R13, H3): a later section (Startup, Lifecycle, Layers, Chat, Info pages, Offline packs,
 * Field filters, Cluster, API tokens, Danger zone) is one entry here and one component, never an edit of the page. Groups,
 * their captions and the order follow v3 (`settings/+page.svelte:70-170`); only groups that have a section are shown.
 */
import type { Component } from 'svelte';
import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
import FileText from '@lucide/svelte/icons/file-text';
import FilterIcon from '@lucide/svelte/icons/filter';
import FlaskConical from '@lucide/svelte/icons/flask-conical';
import ImageIcon from '@lucide/svelte/icons/image';
import KeyRoundIcon from '@lucide/svelte/icons/key-round';
import LayersIcon from '@lucide/svelte/icons/layers';
import MapIcon from '@lucide/svelte/icons/map';
import MessageSquareIcon from '@lucide/svelte/icons/message-square';
import PackageIcon from '@lucide/svelte/icons/package';
import RocketIcon from '@lucide/svelte/icons/rocket';
import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
import type { AdminKey } from '../../../routes/(admin)/admin/shell/messages';
import type { SettingsApi } from './api';
import BrandingSection from './BrandingSection.svelte';
import ChatSection from './ChatSection.svelte';
import LayersSection from './LayersSection.svelte';
import ClusterSection from './ClusterSection.svelte';
import DangerZoneSection from './DangerZoneSection.svelte';
import FieldFiltersSection from './FieldFiltersSection.svelte';
import InfoPagesSection from './InfoPagesSection.svelte';
import MapDefaultsSection from './MapDefaultsSection.svelte';
import OfflinePacksSection from './OfflinePacksSection.svelte';
import ProjectSection from './ProjectSection.svelte';
import StartupSection from './StartupSection.svelte';
import type { ToolStartView } from './start-types';
import TokensSection from './TokensSection.svelte';
import type { SidebarStatus, SidebarTone } from './sidebar-types';
import type { SettingsPageData } from './types';

/** What every section component gets. */
export interface SectionProps {
  readonly data: SettingsPageData;
  readonly locale: Locale;
  /** The project key (for the URL of the icon's blob). */
  readonly project: string;
  readonly api: SettingsApi;
  /** Reloads the page data after a save. */
  readonly reload: () => Promise<void>;
}

export interface SettingsGroupDef {
  readonly key: string;
  readonly label: AdminKey;
}

/** v3's five groups, in v3's order. */
export const SETTINGS_GROUPS: readonly SettingsGroupDef[] = [
  { key: 'general', label: 'settings_group_general' },
  { key: 'map', label: 'settings_group_map' },
  { key: 'features', label: 'settings_group_features' },
  { key: 'integrations', label: 'settings_group_integrations' },
  { key: 'danger', label: 'settings_group_danger' },
];

export interface SettingsSectionDef {
  /** The `?section=` value (v3's ids). */
  readonly id: string;
  readonly group: SettingsGroupDef['key'];
  readonly label: AdminKey;
  readonly icon: Component<{ class?: string }>;
  readonly tone?: SidebarTone;
  /** The status dot of the sidebar item; none when absent. */
  readonly status?: (data: SettingsPageData) => SidebarStatus;
  readonly component: Component<SectionProps>;
}

/** v3's status dot of a tool section: on while the tool starts on for any role (`enabledFeatures.includes(...)`). */
const toolStatus = (view: ToolStartView): SidebarStatus =>
  view.roles.some((r) => r.state === 'active') ? 'on' : 'off';

/** Old `?section=` links of the sections that became one (Status & Freigabe and Template are now `project`). */
const MERGED_SECTIONS: Readonly<Record<string, string>> = { lifecycle: 'project', template: 'project' };

/** The sections that exist, in sidebar order. */
export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  {
    id: 'branding',
    group: 'general',
    label: 'settings_nav_branding',
    icon: ImageIcon,
    component: BrandingSection,
  },
  {
    id: 'layers',
    group: 'map',
    label: 'settings_nav_layers',
    icon: LayersIcon,
    component: LayersSection,
  },
  {
    // One screen for the status and release, the template and its inputs, and the whole project file (owner 2026-10-05).
    id: 'project',
    group: 'general',
    label: 'settings_nav_project_file',
    icon: FlaskConical,
    status: (d) => (d.lifecycle.neverPublished ? 'on' : 'off'),
    component: ProjectSection,
  },
  {
    id: 'startup',
    group: 'general',
    label: 'settings_nav_startup',
    icon: RocketIcon,
    component: StartupSection,
  },
  {
    id: 'map-defaults',
    group: 'map',
    label: 'settings_nav_map_defaults',
    icon: MapIcon,
    component: MapDefaultsSection,
  },
  {
    id: 'chat',
    group: 'features',
    label: 'settings_nav_chat',
    icon: MessageSquareIcon,
    // v3 `chatStatus`: on when the project has the chat.
    status: (data) => (data.chat.enabled ? 'on' : 'off'),
    component: ChatSection,
  },
  {
    id: 'info-pages',
    group: 'features',
    label: 'settings_nav_info_pages',
    icon: FileText,
    status: (d) => (d.infoPages.length > 0 ? 'on' : 'off'),
    component: InfoPagesSection,
  },
  {
    id: 'offline-packs',
    group: 'features',
    label: 'settings_nav_offline_packs',
    icon: PackageIcon,
    status: (d) => (d.packs.length > 0 ? 'on' : 'off'),
    component: OfflinePacksSection,
  },
  {
    id: 'field-filters',
    group: 'features',
    label: 'settings_nav_field_filters',
    icon: FilterIcon,
    status: (data) => toolStatus(data.fieldFilters),
    component: FieldFiltersSection,
  },
  {
    id: 'cluster',
    group: 'features',
    label: 'settings_nav_cluster',
    icon: CircleDotIcon,
    status: (data) => toolStatus(data.cluster),
    component: ClusterSection,
  },
  {
    id: 'api-tokens',
    group: 'integrations',
    label: 'settings_nav_api_tokens',
    icon: KeyRoundIcon,
    component: TokensSection,
  },
  {
    id: 'danger-zone',
    group: 'danger',
    label: 'settings_nav_danger_zone',
    icon: TriangleAlertIcon,
    tone: 'destructive',
    component: DangerZoneSection,
  },
];

/** The first section is the default one (v3: Branding). */
export const DEFAULT_SECTION = SETTINGS_SECTIONS[0]?.id ?? '';

/** The section a `?section=` value names; an unknown or missing value is the default (v3 `currentSection`). */
export function sectionFor(
  requested: string | null,
  sections: readonly SettingsSectionDef[] = SETTINGS_SECTIONS,
): SettingsSectionDef | undefined {
  const id = requested === null ? null : (MERGED_SECTIONS[requested] ?? requested);
  return sections.find((s) => s.id === id) ?? sections[0];
}
