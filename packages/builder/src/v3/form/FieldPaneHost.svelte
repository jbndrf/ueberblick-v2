<script lang="ts">
  // The Felddefinition of the field selected in the form editor (v3 opened it as "Panel 3" next to the editor,
  // `FormEditorView.openFieldDefinition`). The pane is the one of WP-337, which reads "the selected field" from the
  // builder context; the editor owns its own selection, so the pane gets a context whose selection is this field.
  // "Feld vollständig löschen" ends in "nothing selected", which here means back to the form.
  import FieldPane from '../field/FieldPane.svelte';
  import { getBuilderContext, setBuilderContext } from '../shell/context';

  interface Props {
    field: string;
    ondeselect: () => void;
  }
  let { field, ondeselect }: Props = $props();

  const parent = getBuilderContext();
  setBuilderContext({
    ...parent,
    selection: () => ({ kind: 'field', id: field }),
    select: (s) => (s.kind === 'none' ? ondeselect() : parent.select(s)),
  });
</script>

<FieldPane />
