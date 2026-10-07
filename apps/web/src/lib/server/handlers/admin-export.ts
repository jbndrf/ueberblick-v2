/**
 * The export and ZIP-import endpoints of the Projekte page's ⋮ menu over the real runtime (WP-384, S3-8):
 * `GET /api/admin/p/<project>/export/{zip,csv,gpkg}`, `POST /api/admin/projects/import-zip` and
 * `GET /api/admin/projects/import-zip/<job>`. The import creates the project through the same function as "Aus Datei
 * importieren" (`importProjectFile`), deploys it through the deploy route's `deployProject`, and enters the data as
 * runs through the project's one `Store` (R3). The ZIP carries the roster with the login tokens (A-046) and the import
 * restores it through the roster's own functions.
 */
import { randomUUID } from 'node:crypto';
import { parse } from 'yaml';
import { localize, parseProjectFile } from '@ueberblick/core';
import {
  controlTemplateSource,
  createAdminExportHandlers,
  createArchiveImportHandlers,
  createBlobs,
  createServerIds,
  deployProject,
  effectiveDeployedFile,
  effectiveDraftFile,
  importArchive,
  importProjectFile,
  projectStoresFor,
  withOwnIdentity,
  type AdminExportHandlers,
  type ArchiveImportHandlers,
  type ArchiveProblem,
} from '@ueberblick/server';
import { authorizeAdmin } from '../authz';
import { runtime } from '../runtime';
import { removeProject } from './admin-project-delete';
import type { Call } from './http';

const blobsOf = (key: string) =>
  createBlobs({ db: runtime().projectDb(key), store: runtime().blobs.store(key), clock: runtime().clock });

let exports_: AdminExportHandlers | undefined;
const exporter = (): AdminExportHandlers =>
  (exports_ ??= createAdminExportHandlers({
    authorizeAdmin,
    db: (key) => runtime().projectDb(key),
    deployed: (key) => runtime().services.deployed(key),
    project: (key) =>
      runtime()
        .control.prepare<{ name: string; description: string }>(
          'SELECT name, description FROM projects WHERE key = ?',
        )
        .get(key),
    effectiveFile: (key) =>
      runtime().services.deployed(key) !== undefined
        ? effectiveDeployedFile(runtime().projectDb(key))
        : effectiveDraftFile(runtime().projectDb(key), controlTemplateSource(runtime().control)),
    visible: (key) => runtime().services.sync(key).visible,
    blobs: blobsOf,
    // The project ZIP carries the roster with its login tokens (A-046): the file is sensitive.
    roster: (key) => {
      const rt = runtime();
      const project = rt.project(key);
      if (!project) throw new Error(`unknown project ${key}`);
      return { credential: (participantId) => rt.auth.currentCredential(project.id, participantId) };
    },
    now: () => runtime().clock.now(),
  }));

const message = (p: { readonly message: Parameters<typeof localize>[0] }): string =>
  localize(p.message, ['de', 'en']);

let importer_: ArchiveImportHandlers | undefined;
const importer = (): ArchiveImportHandlers =>
  (importer_ ??= createArchiveImportHandlers({
    newId: randomUUID,
    run: (path, name, by, progress) => {
      const rt = runtime();
      const asAdmin = `admin:${by}`;
      return importArchive(
        {
          createProject: (text, projectName) => {
            const fileText = withOwnIdentity(controlTemplateSource(rt.control), text);
            const r = importProjectFile(
              { control: rt.control, openProjectDb: rt.projectDb, clock: rt.clock },
              fileText,
              by,
              projectName,
            );
            return r.ok ? { ok: true, key: r.key, fileText } : { ok: false, problems: r.problems };
          },
          putLive: (key, text) => {
            const file = parseProjectFile(parse(text));
            if (!file.success)
              return { ok: false, problems: [{ path: 'project.yaml', message: 'Not a project file.' }] };
            const r = deployProject(rt.projectDb(key), file.data, asAdmin, {
              clock: rt.clock,
              templates: rt.templates,
              pins: rt.services.pins(key),
              afterDeploy: () => rt.services.afterDeploy(key),
            });
            return r.ok
              ? { ok: true, version: r.version }
              : {
                  ok: false,
                  problems: r.problems.map((p): ArchiveProblem => ({ path: p.path, message: message(p) })),
                };
          },
          removeProject: (key) => {
            removeProject(key);
          },
          onCleanupError: (key) =>
            rt.log.log('blob.delete_failed', { projectKey: key, code: 'delete_failed' }),
          usedTokens: (tokens) => rt.auth.tokensInUse(tokens),
          rosterTarget: (key) => {
            const project = rt.project(key);
            if (!project) throw new Error(`unknown project ${key}`);
            return {
              db: rt.projectDb(key),
              auth: rt.auth,
              projectId: project.id,
              now: () => new Date(rt.clock.now()),
            };
          },
          store: projectStoresFor(rt),
          blobs: blobsOf,
          ids: createServerIds(rt.clock),
          progress,
        },
        path,
        name,
      );
    },
  }));

const asCall = (call: Call) => ({
  request: call.request,
  params: call.params,
  principal: call.locals.admin,
});

export const adminExportHandlers = {
  zip: (call: Call): Response => exporter().zip(asCall(call)),
  csv: (call: Call): Response => exporter().csv(asCall(call)),
  gpkg: (call: Call): Response => exporter().gpkg(asCall(call)),
  importZip: (call: Call): Promise<Response> => importer().start(asCall(call)),
  importZipStatus: (call: Call): Response => importer().status(asCall(call)),
};
