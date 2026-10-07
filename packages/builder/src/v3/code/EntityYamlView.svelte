<script lang="ts">
  // v3 `inspector/EntityYamlView.svelte`: the YAML of the selected element (and its children), shown in
  // the inspector when the toggle says "YAML". The same panel as the Code view (R1); the text is
  // `doc.entityYaml(path)` and Übernehmen is `doc.applyEntityYaml`, the path the task's YAML tab uses.
  import { parseKeyPath, type KeyPath } from '@ueberblick/core';
  import { provenanceLines } from '../../doc';
  import { getBuilderContext } from '../shell/context';
  import YamlPanel from './YamlPanel.svelte';
  import { refSources } from './refs';

  interface Props {
    /** `types.<t>`, `rules.<k>` or `types.<t>.properties.<p>`. */
    path: KeyPath;
  }
  let { path }: Props = $props();

  const ctx = getBuilderContext();
  const doc = $derived(ctx.doc());
  const source = $derived(doc.entityYaml(path).text);
  const sources = $derived(refSources(doc, ctx.type, ctx.locale));
  const base = $derived(parseKeyPath(path) ?? []);
</script>

<YamlPanel
  {ctx}
  testid="entity-yaml"
  hint={ctx.t('code_entity_hint')}
  {source}
  check={(text) => doc.applyEntityYaml(path, text)}
  marks={(text) => provenanceLines(doc, text, base).map((l) => l.provenance)}
  {sources}
/>
