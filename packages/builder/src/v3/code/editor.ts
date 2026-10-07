/**
 * The CodeMirror 6 adapter of the Code view (v3 `code-view/CodeView.svelte`: YAML highlighting, folding,
 * reference completion). This is the only file of the folder that imports CodeMirror; `CodeEditor.svelte`
 * loads it with a dynamic `import()`, so the editor is its own chunk (`lazy.spec.ts`). Added to v3's: a
 * provenance margin and the diagnostics of the document's own checks (the builder's inline problems).
 */
import {
  autocompletion,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  gutter,
  GutterMarker,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from '@codemirror/view';

export interface EditorProblem {
  /** 1-based. */
  readonly line: number;
  readonly message: string;
}

/** One completion the base shows; `apply` is what is inserted (the label when absent). */
export interface EditorOption {
  readonly label: string;
  readonly apply?: string;
  readonly detail?: string;
  readonly type?: string;
}
export interface EditorCompletion {
  /** Offset where the replaced word starts. */
  readonly from: number;
  readonly options: readonly EditorOption[];
}
/** A mark on a range of the text (offsets), for callers that place their own diagnostics. */
export interface EditorDiagnostic {
  readonly from: number;
  readonly to: number;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
}

/**
 * The one CodeMirror base of the builder (R1): YAML, history, completion, the lint gutter, the theme and the
 * handle. The Code view switches on what it adds (provenance and fold gutters, Tab to indent); the old YAML
 * lens (`lenses/yaml/editor.ts`, until S4-22) passes its own theme, completion and save key.
 */
export interface EditorOptions {
  readonly parent: HTMLElement;
  readonly text: string;
  /** Accessible name of the editing area. */
  readonly label: string;
  readonly complete: (text: string, pos: number) => EditorCompletion | undefined;
  /** Which characters keep the popup open (default: not a line break, comma, bracket, colon or hash). */
  readonly validFor?: RegExp;
  readonly onchange: (text: string) => void;
  /** Ctrl/Cmd+S. */
  readonly onsave?: () => void;
  /** Replaces the builder theme. */
  readonly theme?: Extension;
  /** The margin that marks each line with its provenance, and what each mark is called. */
  readonly provenanceLabels?: Readonly<Record<string, string>>;
  readonly fold?: boolean;
  readonly indentWithTab?: boolean;
}

export interface EditorHandle {
  readonly view: EditorView;
  /** Replace the whole text (an external change of the document). */
  setText(text: string): void;
  /** The provenance of each line (index 0 is line 1); anything else leaves the margin empty. */
  setMarks(marks: readonly string[]): void;
  setProblems(problems: readonly EditorProblem[]): void;
  setDiagnostics(diagnostics: readonly EditorDiagnostic[]): void;
  focus(): void;
  text(): string;
  destroy(): void;
}

const setMarksEffect = StateEffect.define<readonly string[]>();
const marksField = StateField.define<readonly string[]>({
  create: () => [],
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setMarksEffect)) return e.value;
    return value;
  },
});

class ProvenanceMarker extends GutterMarker {
  constructor(
    private readonly kind: string,
    private readonly name: string,
  ) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof ProvenanceMarker && other.kind === this.kind;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = `prov prov-${this.kind}`;
    el.title = this.name;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', this.name);
    el.dataset['provenance'] = this.kind;
    return el;
  }
}

export const theme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    fontSize: '0.8125rem',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    overflow: 'auto',
  },
  '.cm-gutters': {
    backgroundColor: 'color-mix(in srgb, var(--muted) 40%, transparent)',
    color: 'var(--muted-foreground)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--muted)',
    border: '1px solid var(--border)',
    color: 'var(--muted-foreground)',
    borderRadius: '0.25rem',
    padding: '0 0.35rem',
  },
  '.cm-gutter-prov': { width: '0.5rem' },
  '.prov': { display: 'block', width: '0.25rem', height: '100%', margin: '0 0.125rem' },
  '.prov-changed': { backgroundColor: 'var(--chart-4, #d97706)' },
  '.prov-added': { backgroundColor: 'var(--chart-2, #16a34a)' },
});

export function mountEditor(o: EditorOptions): EditorHandle {
  const source = (c: CompletionContext): CompletionResult | null => {
    const r = o.complete(c.state.doc.toString(), c.pos);
    if (r === undefined || r.options.length === 0) return null;
    return {
      from: r.from,
      options: r.options.map((x) => ({
        label: x.label,
        ...(x.apply === undefined ? {} : { apply: x.apply }),
        ...(x.type === undefined ? {} : { type: x.type }),
        ...(x.detail === undefined ? {} : { detail: x.detail }),
      })),
      validFor: o.validFor ?? /^[^\n,[\]:#]*$/,
    };
  };
  const labels = o.provenanceLabels;
  const provenance =
    labels === undefined
      ? []
      : [
          marksField,
          gutter({
            class: 'cm-gutter-prov',
            lineMarker(view, line) {
              const kind = view.state.field(marksField)[view.state.doc.lineAt(line.from).number - 1];
              // The template's own lines are the default: only what the overlay touched is marked.
              return kind === undefined || kind === 'template'
                ? null
                : new ProvenanceMarker(kind, labels[kind] ?? kind);
            },
            lineMarkerChange: (u) => u.startState.field(marksField) !== u.state.field(marksField),
            initialSpacer: () => new ProvenanceMarker('spacer', ''),
          }),
        ];
  const view = new EditorView({
    parent: o.parent,
    state: EditorState.create({
      doc: o.text,
      extensions: [
        ...provenance,
        lineNumbers(),
        ...(o.fold === true ? [foldGutter()] : []),
        lintGutter(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle),
        yaml(),
        autocompletion({ override: [source], activateOnTyping: true }),
        keymap.of([
          ...(o.onsave === undefined
            ? []
            : [{ key: 'Mod-s', preventDefault: true, run: () => (o.onsave?.(), true) }]),
          ...(o.indentWithTab === true ? [indentWithTab] : []),
          ...completionKeymap,
          ...(o.fold === true ? foldKeymap : []),
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        EditorView.contentAttributes.of({ 'aria-label': o.label, 'aria-multiline': 'true' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) o.onchange(u.state.doc.toString());
        }),
        o.theme ?? theme,
      ],
    }),
  });
  const setDiagnostics_ = (diagnostics: readonly EditorDiagnostic[]): void => {
    const len = view.state.doc.length;
    view.dispatch(
      setDiagnostics(
        view.state,
        diagnostics.map((d) => ({
          from: Math.min(d.from, len),
          to: Math.min(Math.max(d.to, d.from), len),
          severity: d.severity,
          message: d.message,
        })),
      ),
    );
  };
  return {
    view,
    setText(text) {
      if (text === view.state.doc.toString()) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    setMarks(marks) {
      view.dispatch({ effects: setMarksEffect.of(marks) });
    },
    setProblems(problems) {
      const doc = view.state.doc;
      setDiagnostics_(
        problems.map((p) => {
          const line = doc.line(Math.min(Math.max(p.line, 1), doc.lines));
          return { from: line.from, to: line.to, severity: 'error' as const, message: p.message };
        }),
      );
    },
    setDiagnostics: setDiagnostics_,
    focus: () => view.focus(),
    text: () => view.state.doc.toString(),
    destroy: () => view.destroy(),
  };
}
