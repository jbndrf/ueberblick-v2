/**
 * "ZIP importieren" (WP-384): a new project from a project ZIP. Order: read and check the manifest and the project
 * file (nothing is created while they are wrong), create the project from the file, deploy it when the archive holds
 * data (a run needs a config version), put the blobs back, then enter every feature as a `$seed` run and every
 * non-active lifecycle as a `$lifecycle` run (R3: no table is copied). Progress is reported per batch.
 */
import { parse } from 'yaml';
import {
  compile,
  LIFECYCLE_TASK,
  NO_ASSETS,
  SEED_TASK,
  TemplateFileSchema,
  type FeatureId,
  type Ids,
  type Json,
  type Key,
  type Run,
} from '@ueberblick/core';
import type { BlobService } from '../../blobs/blobs';
import type { Store } from '../../store';
import { SYSTEM_ACTOR } from '../../timers/fire';
import {
  ARCHIVE_ENTRIES,
  ARCHIVE_VERSION,
  ArchiveBlobSchema,
  ArchiveFeatureSchema,
  ArchiveManifestSchema,
  ARCHIVE_LIMITS,
  ARCHIVE_ZIP_LIMITS,
  type ArchiveManifest,
  type ArchiveProblemCode,
} from './manifest';
import { readRoster } from './import-roster';
import { applyRoster, type RosterTarget } from './roster';
import { openZip, ZipCorrupt, ArchiveLimitError, type Chunks, type ZipFile } from './zip';

export interface ArchiveProblem {
  readonly path: string;
  readonly message: string;
  /** Set for a limit that refused the archive (`ARCHIVE_PROBLEM_CODES`): the dialog says it in the user's language. */
  readonly code?: ArchiveProblemCode;
}

export interface ArchiveImportDeps {
  /**
   * Creates the project from the archive's project file (a draft, nothing deployed). `fileText` answers the file the
   * project now holds (its template identity may have been made its own, `identity.ts`); that is what gets deployed.
   */
  createProject(
    fileText: string,
    name: string | undefined,
  ):
    | { readonly ok: true; readonly key: string; readonly fileText: string }
    | { readonly ok: false; readonly problems: readonly ArchiveProblem[] };
  /** Deploys the project file as the project's first config version. */
  putLive(
    key: string,
    fileText: string,
  ):
    | { readonly ok: true; readonly version: number }
    | { readonly ok: false; readonly problems: readonly ArchiveProblem[] };
  /**
   * Removes a project this import created: the admin's one delete path (`deleteProject`, R1). A failed import
   * leaves no project behind; if the removal itself throws, `onCleanupError` hears of it and the startup sweep
   * finishes the files (A-037 'Orphan files').
   */
  removeProject(key: string): void;
  readonly onCleanupError?: (key: string, error: unknown) => void;
  /** Which of these login tokens are already in use on this instance (the token scope is the instance, A-046). */
  usedTokens(tokens: readonly string[]): ReadonlySet<string>;
  /** The roster of a project this import created (its database and auth module), for the participants of the archive. */
  rosterTarget(key: string): RosterTarget;
  store(key: string): Store;
  blobs(key: string): Pick<BlobService, 'put'>;
  readonly ids: Ids;
  readonly progress?: (done: number, total: number) => void;
}

export type ArchiveImportResult =
  | {
      readonly ok: true;
      readonly key: string;
      readonly features: number;
      readonly blobs: number;
      /** Set when participants got fresh login tokens because theirs are in use on this instance (A-046). */
      readonly renewedTokens?: number;
    }
  | { readonly ok: false; readonly problems: readonly ArchiveProblem[] };

/** Runs per batch: one transaction and one doorbell each. */
export const ARCHIVE_BATCH = 200;

const refuse = (message: string, path = ''): ArchiveImportResult => ({
  ok: false,
  problems: [{ path, message }],
});

/** A data file's lines. A line longer than `maxLine` is refused (`LineTooLong`) before more of it is buffered. */
export class LineTooLong extends Error {
  constructor(readonly entry: string) {
    super(`A line of ${entry} is longer than ${ARCHIVE_LIMITS.maxLineBytes} characters.`);
    this.name = 'LineTooLong';
  }
}

async function* lines(source: Chunks, entry: string, maxLine: number): AsyncGenerator<string> {
  let rest = '';
  const decoder = new TextDecoder();
  for await (const chunk of source) {
    rest += decoder.decode(chunk, { stream: true });
    let at = rest.indexOf('\n');
    while (at >= 0) {
      if (at > maxLine) throw new LineTooLong(entry);
      const line = rest.slice(0, at);
      if (line !== '') yield line;
      rest = rest.slice(at + 1);
      at = rest.indexOf('\n');
    }
    // no newline yet: what is held is one unfinished line
    if (rest.length > maxLine) throw new LineTooLong(entry);
  }
  rest += decoder.decode();
  if (rest !== '') yield rest;
}

async function readManifest(zip: ZipFile): Promise<ArchiveManifest | ArchiveProblem> {
  if (!zip.has(ARCHIVE_ENTRIES.manifest) || !zip.has(ARCHIVE_ENTRIES.file))
    return { path: '', message: 'Das ist kein Projektarchiv (manifest.json oder project.yaml fehlt).' };
  let raw: unknown;
  try {
    raw = JSON.parse(await zip.text(ARCHIVE_ENTRIES.manifest));
  } catch (e) {
    if (e instanceof ZipCorrupt || e instanceof ArchiveLimitError) throw e;
    return { path: ARCHIVE_ENTRIES.manifest, message: 'manifest.json ist kein JSON.' };
  }
  const parsed = ArchiveManifestSchema.safeParse(raw);
  if (!parsed.success)
    return { path: ARCHIVE_ENTRIES.manifest, message: 'Das ist kein Überblick-Projektarchiv.' };
  if (parsed.data.version > ARCHIVE_VERSION)
    return {
      path: ARCHIVE_ENTRIES.manifest,
      message: `Das Archiv hat das Format ${parsed.data.version}; diese Version versteht bis ${ARCHIVE_VERSION}.`,
    };
  return parsed.data;
}

/** The checks that need no project: the file compiles and every data entry names a type of it. */
function checkFile(text: string, manifest: ArchiveManifest): ArchiveProblem | Declared {
  let value: unknown;
  try {
    value = parse(text);
  } catch (e) {
    return { path: ARCHIVE_ENTRIES.file, message: e instanceof Error ? e.message : 'Kein YAML.' };
  }
  const shape = TemplateFileSchema.safeParse(value);
  if (!shape.success)
    return {
      path: ARCHIVE_ENTRIES.file,
      message: shape.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  const compiled = compile(shape.data, { assets: NO_ASSETS });
  if (!compiled.ok)
    return { path: ARCHIVE_ENTRIES.file, message: 'Die Projektdatei im Archiv ist ungültig.' };
  for (const type of Object.keys(manifest.types))
    if (shape.data.types?.[type] === undefined)
      return {
        path: ARCHIVE_ENTRIES.data(type),
        message: `Die Objektart ${type} gibt es in der Projektdatei nicht.`,
      };
  const declared = new Map<string, ReadonlySet<string>>();
  for (const [type, decl] of Object.entries(shape.data.types ?? {}))
    declared.set(type, new Set(Object.keys(decl.properties ?? {})));
  return { declared };
}

/** The property keys each type of the archive's file declares. */
interface Declared {
  readonly declared: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The folded properties of the archive still hold the values of a property a later deploy removed with "discard the
 * values" (`deploy/moves.ts`: they stay in the history, nothing moves; the fold keeps them, the config no longer
 * serves them). A `$seed` run refuses a key its type does not declare, so only the declared properties are entered:
 * the new project's history starts at the seed, and what the file does not serve is not part of it.
 */
function served(
  properties: Readonly<Record<string, unknown>>,
  declared: ReadonlySet<string> | undefined,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).filter(([k]) => declared?.has(k) === true));
}

export async function importArchive(
  deps: ArchiveImportDeps,
  zipPath: string,
  name?: string,
): Promise<ArchiveImportResult> {
  let zip: ZipFile;
  try {
    zip = await openZip(zipPath, ARCHIVE_ZIP_LIMITS);
  } catch (e) {
    if (e instanceof ArchiveLimitError) return tooLarge(e);
    return refuse(e instanceof Error ? e.message : 'Die Datei ist kein ZIP.');
  }
  let key: string | undefined;
  try {
    const manifest = await readManifest(zip);
    if (!('format' in manifest)) return { ok: false, problems: [manifest] };
    const fileText = await zip.text(ARCHIVE_ENTRIES.file);
    const bad = checkFile(fileText, manifest);
    if ('path' in bad) return { ok: false, problems: [bad] };
    const { declared } = bad;
    const total = Object.values(manifest.types).reduce((n, t) => n + t.count, 0) + manifest.blobs.count;
    let done = 0;
    deps.progress?.(0, total);
    const roster = await readRoster(
      zip,
      manifest,
      (entry) => lines(zip.open(entry), entry, ARCHIVE_LIMITS.maxLineBytes),
      deps.usedTokens,
    );
    if (roster !== undefined && 'path' in roster) return { ok: false, problems: [roster] };

    const made = deps.createProject(fileText, name);
    if (!made.ok) return { ok: false, problems: made.problems };
    const created = made.key;
    key = created;
    const fail = (problems: readonly ArchiveProblem[]): ArchiveImportResult => {
      cleanup(deps, created);
      key = undefined;
      return { ok: false, problems };
    };
    let renewed = 0;
    if (roster !== undefined) {
      const restored = applyRoster(
        deps.rosterTarget(created),
        roster.columns,
        roster.participants,
        roster.inUse,
      );
      if (!restored.ok)
        return fail([{ path: ARCHIVE_ENTRIES.rosterParticipants, message: restored.message }]);
      renewed = restored.renewed;
    }
    if (!manifest.deployed) return { ok: true, key: created, features: 0, blobs: 0, ...renewedOf(renewed) };
    const deployed = deps.putLive(created, made.fileText);
    if (!deployed.ok) return fail(deployed.problems);

    let blobs = 0;
    if (manifest.blobs.count > 0 && zip.has(ARCHIVE_ENTRIES.blobIndex)) {
      const store = deps.blobs(created);
      for await (const line of lines(
        zip.open(ARCHIVE_ENTRIES.blobIndex),
        ARCHIVE_ENTRIES.blobIndex,
        ARCHIVE_LIMITS.maxLineBytes,
      )) {
        const b = ArchiveBlobSchema.safeParse(JSON.parse(line));
        if (!b.success || !zip.has(ARCHIVE_ENTRIES.blob(b.data.sha256)))
          return fail([{ path: ARCHIVE_ENTRIES.blobIndex, message: 'Ein Anhang fehlt im Archiv.' }]);
        await store.put(zip.open(ARCHIVE_ENTRIES.blob(b.data.sha256)), b.data.mime, b.data.sha256);
        blobs++;
        deps.progress?.(++done, total);
      }
    }

    const store = deps.store(created);
    let features = 0;
    for (const type of Object.keys(manifest.types)) {
      // A `$lifecycle` run needs its feature to exist, so it goes in the batch after the one that seeds it.
      let seeds: Run[] = [];
      let states: Run[] = [];
      const submit = (runs: readonly Run[]): ArchiveProblem | undefined => {
        if (runs.length === 0) return undefined;
        const r = store.submitBatch(runs);
        return r.outcome === 'refused'
          ? {
              path: ARCHIVE_ENTRIES.data(type),
              message: `${r.refusal.message} (${runs[r.index]?.featureId ?? ''})`,
            }
          : undefined;
      };
      const flush = (): ArchiveProblem | undefined => {
        const problem = submit(seeds) ?? submit(states);
        if (problem !== undefined) return problem;
        features += seeds.length;
        done += seeds.length;
        seeds = [];
        states = [];
        deps.progress?.(done, total);
        return undefined;
      };
      for await (const line of lines(
        zip.open(ARCHIVE_ENTRIES.data(type)),
        ARCHIVE_ENTRIES.data(type),
        ARCHIVE_LIMITS.maxLineBytes,
      )) {
        const f = ArchiveFeatureSchema.safeParse(JSON.parse(line));
        if (!f.success)
          return fail([{ path: ARCHIVE_ENTRIES.data(type), message: 'Eine Zeile ist kein Objekt.' }]);
        const id = f.data.id as FeatureId;
        seeds.push({
          id: deps.ids.runId(),
          task: SEED_TASK as Key,
          actor: SYSTEM_ACTOR,
          configVersion: deployed.version,
          featureId: id,
          input: { type, values: served(f.data.properties, declared.get(type)) as { [k: string]: Json } },
        });
        if (f.data.lifecycle !== 'active')
          states.push({
            id: deps.ids.runId(),
            task: LIFECYCLE_TASK as Key,
            actor: SYSTEM_ACTOR,
            configVersion: deployed.version,
            featureId: id,
            input: { state: f.data.lifecycle },
          });
        if (seeds.length >= ARCHIVE_BATCH) {
          const problem = flush();
          if (problem !== undefined) return fail([problem]);
        }
      }
      const problem = flush();
      if (problem !== undefined) return fail([problem]);
    }
    return { ok: true, key: created, features, blobs, ...renewedOf(renewed) };
  } catch (e) {
    if (key !== undefined) cleanup(deps, key);
    if (e instanceof ArchiveLimitError) return tooLarge(e);
    if (e instanceof LineTooLong)
      return { ok: false, problems: [{ path: e.entry, message: e.message, code: 'line_too_long' }] };
    if (e instanceof ZipCorrupt) return refuse(e.message);
    throw e;
  }
}

const renewedOf = (n: number): { renewedTokens?: number } => (n > 0 ? { renewedTokens: n } : {});

/** A failed import removes the project it created; a failing removal is reported, never thrown. */
function cleanup(deps: ArchiveImportDeps, key: string): void {
  try {
    deps.removeProject(key);
  } catch (e) {
    deps.onCleanupError?.(key, e);
  }
}

/** A limit of the codec as the typed problem the dialog shows. */
const tooLarge = (e: ArchiveLimitError): ArchiveImportResult => ({
  ok: false,
  problems: [{ path: e.entry, message: e.message, code: e.code }],
});
