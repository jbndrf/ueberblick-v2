<script lang="ts">
  // v3 `settings/sections/ClusterSection.svelte` (102 lines): the section frame with one "Beim Start aktiv" row.
  // v4: the row is the cluster tool's availability per role (`ToolStartCard`); the description says what the tool does
  // in v4 (clustering itself is always on, the tool un-clusters, WP-666), not v3's "off by default".
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import SettingsSection from './SettingsSection.svelte';
  import type { SectionProps } from './sections';
  import ToolStartCard from './ToolStartCard.svelte';

  let { data, locale, api, reload }: SectionProps = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);
</script>

<SettingsSection name={t('settings_cluster_title')} description={t('settings_cluster_description')}>
  <ToolStartCard view={data.cluster} tool="cluster" hint="settings_cluster_hint" {locale} {api} {reload} />
</SettingsSection>
