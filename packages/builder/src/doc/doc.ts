/** The Doc implementation: an immutable pair of template data and overlay YAML Document (contract.ts). */
import { localize } from '@ueberblick/core/locale';
import { contentHash } from '@ueberblick/core/compile';
import { parse, parseDocument, type Document } from 'yaml';
import {
  OverlayFileSchema,
  TemplateFileSchema,
  compile,
  NO_ASSETS,
  merge,
  formatKeyPath,
  parseKeyPath,
  problemsFromMergeIssues,
  type KeyPath,
  type OverlayFile,
  type Problem,
  type Provenance,
  type TemplateFile,
} from '@ueberblick/core';
import {
  DocOpenError,
  type ApplyOpsResult,
  type ApplyResult,
  type Doc,
  type EntityYaml,
  type EntityYamlResult,
  type Op,
  type Refusal,
  type ReplaceResult,
  type SaveIfResult,
  type SaveResult,
} from './contract';
import { applyEntityYaml, entityYaml } from './entity-yaml';
import { applyOp, isPrefix, isProperPrefix, sameData, valueAt } from './ops';

interface Evaluated {
  readonly effective: TemplateFile;
  readonly provenance: ReadonlyMap<KeyPath, Provenance>;
  readonly problems: readonly Problem[];
  /** False when the effective file breaks the file schema (its problems are `schema_invalid`). */
  readonly valid: boolean;
}

/**
 * Merge, check the shape, then compile the effective file: the only source of the panel's problems,
 * one list. A file that breaks the schema is not compiled (compile takes valid files); the schema
 * issues become `schema_invalid` problems after the merge problems.
 */
function evaluate(template: TemplateFile, overlay: OverlayFile): Evaluated {
  const m = merge(template, overlay);
  const mergeProblems = problemsFromMergeIssues(m.issues);
  const shape = TemplateFileSchema.safeParse(m.file);
  if (!shape.success) {
    const schemaProblems = shape.error.issues.map((i): Problem => ({
      path: formatKeyPath(i.path.map(String)),
      code: 'schema_invalid',
      message: i.message,
      hint: `change the value so it fits the file schema: ${i.message}`,
    }));
    return {
      effective: m.file,
      provenance: m.provenance,
      problems: [...mergeProblems, ...schemaProblems],
      valid: false,
    };
  }
  const c = compile(shape.data, { assets: NO_ASSETS });
  return {
    effective: shape.data,
    provenance: m.provenance,
    problems: [...mergeProblems, ...(c.ok ? c.warnings : c.problems)],
    valid: true,
  };
}

/** Codes of merge problems that mean an overlay entry did nothing (or was refused) instead of what it says. */
const DEAD_ENTRY_CODES: readonly string[] = ['unknown_path', 'path_exists', 'lock_violation'];

const problemKey = (p: Problem): string => `${p.code} ${p.path}`;

type Why = Omit<Refusal, 'path'>;

/** Why `op` did not take effect in `doc`, or `undefined` when it did (R11: an op never silently does nothing). */
function ineffective(before: readonly Problem[], doc: Doc, op: Op, segs: readonly string[]): Why | undefined {
  const known = new Set(before.map(problemKey));
  const fresh = doc.problems().find((p) => DEAD_ENTRY_CODES.includes(p.code) && !known.has(problemKey(p)));
  if (fresh) {
    const message = localize(fresh.message, []) || `${fresh.path}: ${fresh.code}`;
    return { code: 'dead_entry', message, problems: [fresh] };
  }
  const effective = doc.effective();
  const isInput = op.kind === 'set' && segs[0] === 'inputs' && segs.length === 2;
  if (op.kind === 'set' || op.kind === 'add') {
    const got = valueAt(effective, isInput ? [...segs, 'default'] : segs);
    if (!sameData(got, op.value)) {
      return {
        code: 'not_in_effective',
        message: `${op.path} would not take this value in the effective file (it is hidden, or a parent does not allow it).`,
        params: { path: op.path },
      };
    }
  } else if (op.kind === 'hide' && valueAt(effective, segs) !== undefined) {
    return {
      code: 'still_in_effective',
      message: `${op.path} would still be in the effective file.`,
      params: { path: op.path },
    };
  }
  return undefined;
}

const schemaRefusal = (ev: Evaluated): Why => {
  const problems = ev.problems.filter((p) => p.code === 'schema_invalid');
  const detail = problems.map((p) => `${p.path}: ${p.message}`).join('; ');
  return { code: 'schema', message: `The effective file would break the file schema: ${detail}`, problems };
};

interface Base {
  readonly template: TemplateFile;
  readonly templateSrc: string;
  readonly overlayDoc: Document;
  /** The overlay text as it was read or saved; returned unchanged while the Doc is not dirty. */
  readonly baseSrc: string;
  /** Text set by `replaceOverlay`, saved as is until the next op; `undefined` otherwise. */
  readonly typedSrc?: string | undefined;
  readonly revision: string;
  readonly dirty: boolean;
}

class DocImpl implements Doc {
  readonly template: TemplateFile;
  readonly templateSrc: string;
  readonly revision: string;
  readonly dirty: boolean;
  private readonly overlayDoc: Document;
  private readonly baseSrc: string;
  private readonly typedSrc: string | undefined;
  private readonly data: OverlayFile;
  private readonly ev: Evaluated;

  private constructor(b: Base, data: OverlayFile, ev: Evaluated) {
    this.template = b.template;
    this.templateSrc = b.templateSrc;
    this.revision = b.revision;
    this.dirty = b.dirty;
    this.overlayDoc = b.overlayDoc;
    this.baseSrc = b.baseSrc;
    this.typedSrc = b.typedSrc;
    this.data = data;
    this.ev = ev;
  }

  static create(b: Base): DocImpl {
    const data = b.overlayDoc.toJS() as OverlayFile;
    return new DocImpl(b, data, evaluate(b.template, data));
  }

  overlay(): OverlayFile {
    return this.data;
  }
  effective(): TemplateFile {
    return this.ev.effective;
  }
  problems(): readonly Problem[] {
    return this.ev.problems;
  }

  provenance(path: KeyPath): Provenance {
    const segs = parseKeyPath(path);
    if (!segs) return 'template';
    let below = false;
    for (const [p, prov] of this.ev.provenance) {
      const ps = parseKeyPath(p);
      if (!ps) continue;
      if (isPrefix(ps, segs)) return prov;
      if (isProperPrefix(segs, ps)) below = true;
    }
    return below ? 'changed' : 'template';
  }

  apply(op: Op): ApplyResult {
    return this.step(op, true);
  }

  applyBatch(ops: readonly Op[]): ApplyOpsResult {
    let cur = this.self();
    let problems = this.ev.problems;
    for (const op of ops) {
      const r = cur.step(op, false);
      if (r.refused !== undefined) return { refused: r.refused };
      cur = r.doc as DocImpl;
      problems = r.problems;
    }
    if (this.ev.valid && !cur.ev.valid) {
      return { refused: { path: ops.at(-1)?.path ?? '', ...schemaRefusal(cur.ev) } };
    }
    return { doc: cur, problems };
  }

  private self(): DocImpl {
    return this;
  }

  /** One op; `schema` false leaves the file-schema check to the caller (a batch checks its end state). */
  private step(op: Op, schema: boolean): ApplyResult {
    const segs = parseKeyPath(op.path);
    if (!segs) {
      const message = `${op.path} is not a key path: write segments as bare keys (a-z, 0-9, _) or as ["bracketed JSON strings"].`;
      const refused: Refusal = { path: op.path, code: 'bad_path', message, params: { path: op.path } };
      return { doc: this, problems: this.ev.problems, refused };
    }
    const next = this.overlayDoc.clone();
    const out = applyOp(next, this.template, op, segs);
    if ('refused' in out) {
      return {
        doc: this,
        problems: this.ev.problems,
        refused: { path: op.path, code: 'scalar_above', message: out.refused, params: { shown: out.shown } },
      };
    }
    if (!out.changed && this.typedSrc === undefined) return { doc: this, problems: this.ev.problems };
    const doc = DocImpl.create({ ...this.base(), typedSrc: undefined, overlayDoc: next, dirty: true });
    if (schema && this.ev.valid && !doc.ev.valid) {
      return {
        doc: this,
        problems: this.ev.problems,
        refused: { path: op.path, ...schemaRefusal(doc.ev) },
      };
    }
    const dead = ineffective(this.ev.problems, doc, op, segs);
    if (dead !== undefined) {
      return { doc: this, problems: this.ev.problems, refused: { path: op.path, ...dead } };
    }
    return { doc, problems: doc.problems() };
  }

  replaceOverlay(text: string): ReplaceResult {
    let overlayDoc: Document;
    try {
      overlayDoc = parseOverlay(this.template, text);
    } catch (e) {
      const message = e instanceof DocOpenError ? [e.message, ...e.issues].join(' ') : String(e);
      return {
        doc: this,
        problems: this.ev.problems,
        refused: { path: '', code: 'overlay_unreadable', message },
      };
    }
    if (text === this.save().overlaySrc) return { doc: this, problems: this.ev.problems };
    const doc = DocImpl.create({ ...this.base(), overlayDoc, typedSrc: text, dirty: text !== this.baseSrc });
    return { doc, problems: doc.problems() };
  }

  entityYaml(path: KeyPath): EntityYaml {
    return entityYaml(this, path);
  }

  applyEntityYaml(path: KeyPath, text: string): EntityYamlResult {
    return applyEntityYaml(this, path, text);
  }

  save(): SaveResult {
    const overlaySrc = this.typedSrc ?? (this.dirty ? String(this.overlayDoc) : this.baseSrc);
    return { overlaySrc, revision: contentHash(overlaySrc) };
  }

  saveIf(expected: string): SaveIfResult {
    if (expected !== this.revision)
      return { ok: false, reason: 'stale_revision', expected, opened: this.revision };
    const saved = this.save();
    const doc = new DocImpl(
      { ...this.base(), baseSrc: saved.overlaySrc, revision: saved.revision, dirty: false },
      this.data,
      this.ev,
    );
    return { ok: true, ...saved, doc };
  }

  private base(): Base {
    return {
      template: this.template,
      templateSrc: this.templateSrc,
      overlayDoc: this.overlayDoc,
      baseSrc: this.baseSrc,
      typedSrc: this.typedSrc,
      revision: this.revision,
      dirty: this.dirty,
    };
  }
}

/** Parses and checks overlay text against the template: YAML, file schema, `extends`. Throws `DocOpenError`. */
function parseOverlay(template: TemplateFile, overlaySrc: string): Document {
  const overlayDoc = parseDocument(overlaySrc);
  if (overlayDoc.errors.length > 0) {
    throw new DocOpenError(
      'The overlay is not valid YAML.',
      overlayDoc.errors.map((e) => e.message),
    );
  }
  const ov = OverlayFileSchema.safeParse(overlayDoc.toJS());
  if (!ov.success) {
    throw new DocOpenError(
      'The overlay does not match the file schema.',
      ov.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const [key, pinned] = ov.data.extends.split('@') as [string, string];
  const t = template.template;
  // `extends` names a major (`key@1`) or the exact version the template is (`key@1.0.0`, what an import pins).
  if (key !== t.key || (pinned !== t.version && pinned !== t.version.split('.')[0])) {
    throw new DocOpenError(
      `The overlay extends ${ov.data.extends}, but the template is ${t.key}@${t.version}.`,
      [],
    );
  }
  return overlayDoc;
}

export function openProject(templateSrc: string, overlaySrc: string): Doc {
  let templateData: unknown;
  try {
    templateData = parse(templateSrc);
  } catch (e) {
    throw new DocOpenError('The template is not valid YAML.', [String(e)]);
  }
  const tpl = TemplateFileSchema.safeParse(templateData);
  if (!tpl.success) {
    throw new DocOpenError(
      'The template does not match the file schema.',
      tpl.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const overlayDoc = parseOverlay(tpl.data, overlaySrc);
  const doc = DocImpl.create({
    template: tpl.data,
    templateSrc,
    overlayDoc,
    baseSrc: overlaySrc,
    revision: contentHash(overlaySrc),
    dirty: false,
  });
  return doc;
}
