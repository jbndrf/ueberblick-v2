/**
 * The Versions area of the builder on the server (docs/08 "Diffs and deploys"): deploy the working
 * draft, roll back, deploy an upgraded overlay. It calls the WP-112
 * pipeline (`deployProject`, `plan`) and the builder's own plan check, so the lens and the API
 * cannot disagree (R1). Publishing a template version is `publishTemplateVersion` in `packages/server` (WP-395). Nothing here decides what a change means: `core.diff` and
 * `core.template.breakingChanges` do.
 */
import {
  buildPlan,
  DocOpenError,
  missingMappings,
  openProject,
  parseOverlaySource,
  problemItems,
  type DeployOutcome,
  type Mapping,
  type UpgradeOffer,
  type VersionRow,
  type VersionsSnapshot,
} from '@ueberblick/builder';
import { stringify } from 'yaml';
import {
  compareVersions,
  compile,
  NO_ASSETS,
  merge,
  servedSql,
  localize,
  type OverlayFile,
  type Problem,
  type TemplateFile,
} from '@ueberblick/core';
import {
  createDraftStore,
  deployProject,
  deployedVersion,
  draftSources,
  ensureDraft,
  loadConfig,
  plan,
  versions,
  type Db,
  type PinDeps,
  type TemplateCatalog,
  type TemplateSource,
  type VersionChoices,
} from '@ueberblick/server';
import { blockersOf, groupsOf, mappingsOf } from '../../lib/admin/deploy/plan-view';
import type { Blocker, DeployPlan } from '../../lib/admin/deploy/types';

export interface VersionsDeps {
  readonly clock: { now(): string };
  readonly templates: TemplateSource;
  readonly catalog: TemplateCatalog;
  /** The project's `ProjectServices.afterDeploy`: timers and cron rows follow every deploy (WP-169). */
  afterDeploy(): void;
  /** The project's `ProjectServices.pins`: a `keep` choice pins the running Objekte through it (WP-317); without it only `move` deploys. */
  readonly pins?: PinDeps;
}

/** What the dry run of the draft takes: the deploy choice per Objektart and the language of the blocker texts. */
export interface PlanOptions {
  readonly choices?: VersionChoices;
  readonly locale?: string;
}

type Mappings = Readonly<Record<string, Mapping>>;

/** Engine problems (a refused choice, a compile problem the document did not show) as blockers. */
const fromProblems = (problems: readonly Problem[], locale: string): readonly Blocker[] =>
  problems.map((p, i) => ({
    id: `${i}:${p.code}:${p.path}`,
    path: p.path,
    message: localize(p.message, [locale]),
    type: /^types\.([^.[\]]+)/.exec(p.path)?.[1] ?? null,
  }));

const problem = (path: string, code: Problem['code'], message: string): Problem => ({
  path,
  code,
  message: { en: message },
});
const blocked = (problems: readonly Problem[]): DeployOutcome => ({
  ok: false,
  reason: 'problems',
  problems,
});

/** The project's database and the Versions services on top of it. */
export function createVersionsService(db: Db, deps: VersionsDeps) {
  const store = createDraftStore(db);
  const pipeline = { clock: deps.clock, templates: deps.templates };
  const live = {
    ...pipeline,
    afterDeploy: deps.afterDeploy,
    ...(deps.pins === undefined ? {} : { pins: deps.pins }),
  };

  function featureCounts(): Record<string, number> {
    const rows = db
      .prepare<{ type: string; n: number }>(
        `SELECT type, COUNT(*) AS n FROM features WHERE ${servedSql('lifecycle')} GROUP BY type`,
      )
      .all();
    return Object.fromEntries(rows.map((r) => [r.type, r.n]));
  }

  /** The effective file of the running config version; `undefined` before the first deploy. */
  function deployedFile(): TemplateFile | undefined {
    const running = deployedVersion(db);
    return running && loadConfig(db, running.version)?.file;
  }

  /** The newest published version above the one the draft is on, when there is one. */
  function upgradeOffer(): UpgradeOffer | null {
    const draft = store.get();
    if (!draft) return null;
    const newer = deps.catalog
      .versionsOf(draft.template)
      .filter((f) => compareVersions(f.template.version, draft.templateVersion) > 0)
      .sort((a, b) => compareVersions(b.template.version, a.template.version))[0];
    return newer ? { from: draft.templateVersion, to: newer.template.version, template: newer } : null;
  }

  /** Deploys `file` (a project file): problems block it, and so does a breaking change without a mapping. A `{ to }` mapping becomes `$move` runs (WP-307). */
  function deployFile(
    file: OverlayFile | TemplateFile,
    by: string,
    mappings: Mappings,
    choices: VersionChoices = {},
  ): DeployOutcome {
    const dry = plan(db, file, pipeline, choices);
    if (!dry.ok) return blocked(dry.problems);
    const before = deployedFile();
    const base = 'extends' in file ? deps.templates.resolve(file.extends) : file;
    if (base === undefined)
      return blocked([problem('extends', 'dangling_reference', 'The template is not available.')]);
    const effective = 'extends' in file ? merge(base, file).file : file;
    const needed = missingMappings(buildPlan({ deployed: before, effective, featureCounts: {} }), mappings);
    if (needed.length > 0) return { ok: false, reason: 'mapping_required', paths: needed };
    const r = deployProject(db, file, by, live, mappings, choices);
    return r.ok
      ? { ok: true, version: r.version, created: r.created, warnings: r.warnings }
      : blocked(r.problems);
  }

  return {
    snapshot(): VersionsSnapshot {
      const running = deployedVersion(db);
      const file = running && loadConfig(db, running.version)?.file;
      return {
        versions: versions(db).map((v): VersionRow => ({ ...v })),
        deployed: running && file ? { version: running.version, file } : null,
        featureCounts: featureCounts(),
        upgrade: upgradeOffer(),
      };
    },

    /**
     * The whole project file as YAML, live and draft (WP-506, "Projektdatei vergleichen"): the effective file of the running
     * version (`null` before the first deploy) and of the saved draft (`null` without a draft or when it does not open).
     */
    compareFiles(): { live: string | null; draft: string | null } {
      const live = deployedFile();
      const draft = store.get();
      const sources = draft && draftSources(draft, deps.templates);
      const text = (file: TemplateFile): string => stringify(file, { lineWidth: 0, sortMapEntries: true });
      let draftText: string | null = null;
      try {
        // Like the deploy: the overlay merged onto its template, then compiled (defaults filled in), as the live file is stored.
        const overlay = sources && openProject(sources.templateSrc, sources.overlaySrc).overlay();
        const base = overlay && deps.templates.resolve(overlay.extends);
        const compiled = overlay && base && compile(merge(base, overlay).file, { assets: NO_ASSETS });
        draftText = compiled?.ok ? text(compiled.config.file) : null;
      } catch (e) {
        if (!(e instanceof DocOpenError)) throw e;
      }
      return { live: live === undefined ? null : text(live), draft: draftText };
    },

    versionFile: (version: number): TemplateFile | undefined => loadConfig(db, version)?.file,

    /**
     * A dry run of the saved draft for the deploy overview (WP-360): the diff per Objektart with the affected counts, the
     * counts of the "belassen / verschieben" choice, the mappings a breaking change needs, the blockers
     * (`Doc.problems()`) and the warnings. Nothing is written.
     */
    planDraft(opts: PlanOptions = {}): DeployPlan {
      const draft = store.get();
      const sources = draft && draftSources(draft, deps.templates);
      const none: DeployPlan = {
        revision: draft?.revision ?? null,
        first: false,
        warnings: [],
        groups: [],
        versions: [],
        mappings: [],
        blockers: [],
      };
      if (!draft || !sources) return none;
      try {
        const doc = openProject(sources.templateSrc, sources.overlaySrc);
        const locale = opts.locale ?? 'en';
        const blockers = blockersOf(problemItems(doc, locale));
        const dry = plan(db, doc.overlay(), pipeline, opts.choices ?? {});
        if (!dry.ok)
          return { ...none, blockers: blockers.length > 0 ? blockers : fromProblems(dry.problems, locale) };
        const before = deployedFile();
        const after = doc.effective();
        const counts = featureCounts();
        const built = buildPlan({ deployed: before, effective: after, featureCounts: counts });
        const input = {
          before,
          after,
          diff: dry.diff,
          versions: dry.versions,
          affected: built.affected,
          locale,
        };
        return {
          ...none,
          first: before === undefined,
          warnings: dry.warnings,
          groups: groupsOf(input),
          versions: dry.versions,
          mappings: mappingsOf(input, built.mappings),
          blockers,
        };
      } catch (e) {
        if (e instanceof DocOpenError)
          return {
            ...none,
            blockers: e.issues.map((m, i) => ({ id: `${i}:open`, path: '', message: m, type: null })),
          };
        throw e;
      }
    },

    /** Deploys the saved draft; `revision` is the one the plan was made from. */
    deployDraft(
      by: string,
      revision: number,
      mappings: Mappings,
      choices: VersionChoices = {},
    ): DeployOutcome {
      const draft = store.get();
      if (!draft || draft.revision !== revision) return { ok: false, reason: 'stale' };
      const sources = draftSources(draft, deps.templates);
      if (!sources)
        return blocked([problem('extends', 'dangling_reference', 'The template is not available.')]);
      try {
        return deployFile(
          openProject(sources.templateSrc, sources.overlaySrc).overlay(),
          by,
          mappings,
          choices,
        );
      } catch (e) {
        if (e instanceof DocOpenError) return blocked(e.issues.map((i) => problem('', 'schema_invalid', i)));
        throw e;
      }
    },

    /** A rollback is a deploy of the stored file of that version: the same checks, the same path. */
    rollback(by: string, version: number): DeployOutcome | undefined {
      const file = loadConfig(db, version)?.file;
      return file && deployFile(file, by, {});
    },

    /**
     * Deploys an upgraded overlay text (it extends a newer template than the draft). On success the
     * draft starts again from the deployed version, because it is pinned to the old template.
     */
    upgrade(by: string, overlayText: string, mappings: Mappings, at: string): DeployOutcome {
      const draft = store.get();
      const sources = draft && draftSources(draft, deps.templates);
      if (!sources) return { ok: false, reason: 'stale' };
      const parsed = parseOverlaySource(overlayText);
      if (!parsed.ok) return blocked(parsed.messages.map((m) => problem('', 'schema_invalid', m)));
      const overlay = parsed.file;
      const r = deployFile(overlay, by, mappings);
      if (r.ok) {
        // TODO(WP-137): replace with `DraftStore.reset()`.
        // Seam: `DraftStore` has no reset yet; the draft row is dropped and seeded again from the deployed version.
        db.prepare('DELETE FROM builder_draft').run();
        ensureDraft(db, { now: () => at }, by);
      }
      return r;
    },
  };
}

export type VersionsService = ReturnType<typeof createVersionsService>;
