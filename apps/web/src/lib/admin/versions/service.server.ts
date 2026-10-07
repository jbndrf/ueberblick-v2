/**
 * What the Versionen page reads and does on the server. Reads and rollbacks go through the Versions service of the
 * builder routes (`createVersionsService`, the same one `/builder-api/<project>/...` uses, R1); "Entwurf verwerfen" is
 * `DraftStore.reset` to the deployed version's own overlay.
 */
import { stringify } from 'yaml';
import type { OverlayFile, TemplateFile } from '@ueberblick/core';
import { controlCatalog, createDraftStore, draftSources, loadConfig, type Db } from '@ueberblick/server';
import { createVersionsService } from '../../../routes/(builder)/builder-versions';
import { runtime } from '../../server/runtime';
import type {
  UpgradeData,
  VersionLine,
  VersionsPageData,
} from '../../../routes/(admin)/admin/projects/[projectId]/versions/types';

export function versionsService(project: string) {
  const rt = runtime();
  const db = rt.projectDb(project);
  return {
    db,
    rt,
    service: createVersionsService(db, {
      clock: rt.clock,
      templates: rt.templates,
      catalog: controlCatalog(rt.control),
      afterDeploy: () => rt.services.afterDeploy(project),
    }),
  };
}

const countTypes = (file: TemplateFile | undefined): number => Object.keys(file?.types ?? {}).length;

/** The list, newest first (v3 sorted `-version`), and the upgrade offer when a newer template exists. */
export function loadVersionsPage(project: string): VersionsPageData {
  const { db, service, rt } = versionsService(project);
  const snap = service.snapshot();
  const versions = [...snap.versions].reverse().map((v): VersionLine => ({
    version: v.version,
    status: v.status,
    objektarten: countTypes(loadConfig(db, v.version)?.file),
    createdAt: v.createdAt,
    template: v.template,
    templateVersion: v.templateVersion,
  }));
  const draft = createDraftStore(db).get();
  const sources = snap.upgrade && draft && draftSources(draft, rt.templates);
  const upgrade: UpgradeData | null =
    snap.upgrade && sources
      ? {
          offer: snap.upgrade,
          templateSrc: sources.templateSrc,
          overlaySrc: sources.overlaySrc,
          deployed: snap.deployed?.file,
          featureCounts: snap.featureCounts,
        }
      : null;
  return { versions, upgrade };
}

interface DeployedRow {
  template: string | null;
  template_version: string | null;
  overlay: string;
}

/**
 * Throws the working draft away: it becomes the deployed version's overlay again (a plain template deployed without
 * an overlay starts as an empty overlay on its major, as `ensureDraft` does). The revision advances, so an editor
 * still holding the old one is refused. Returns false when nothing is deployed.
 */
export function discardDraft(db: Db, by: string, at: string): boolean {
  const row = db
    .prepare<DeployedRow>(
      "SELECT template, template_version, overlay FROM config_versions WHERE status = 'deployed'",
    )
    .get();
  if (!row?.template || !row.template_version) return false;
  const stored = JSON.parse(row.overlay) as Partial<OverlayFile>;
  const overlay: Partial<OverlayFile> =
    'extends' in stored
      ? stored
      : { schema: 'ueberblick/1', extends: `${row.template}@${row.template_version.split('.')[0]}` };
  createDraftStore(db).reset({
    template: row.template,
    templateVersion: row.template_version,
    overlay: stringify(overlay),
    by,
    at,
  });
  return true;
}

/** `discardDraft` for a project, as the discard route calls it. */
export function discardDraftOf(project: string, by: string): boolean {
  const { db, rt } = versionsService(project);
  return discardDraft(db, by, rt.clock.now());
}
