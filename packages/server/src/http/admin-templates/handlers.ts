/**
 * `POST /api/admin/templates` (WP-383, S3-7 "Als Vorlage veröffentlichen"): publishes the project's deployed file as a
 * template version. The handler owns the request and the answers; the publish gate is `publishTemplateVersion`
 * (`packages/server/src/templates`, the function the builder's Versions page calls too, R1).
 *
 *   body { project, key, version, label }  ->  201 { key, version, created } | 400 { problems } | 409 | 422 { messages }
 */
import { KeySchema, SemverSchema, type LocalizedString } from '@ueberblick/core';
import { stringify } from 'yaml';
import type { Principal } from '../../auth/contract';
import type { Db } from '../../db/driver';
import { controlCatalog, publishTemplateVersion } from '../../templates';
import { jsonResponse } from '../shared/errors';
import { templateFromProject, type EffectiveResult } from '../admin-projects';

export interface AdminTemplatesDeps {
  /** The refusing response (401, 403, 404), or the authorised project key. */
  authorizeAdmin(principal: Principal | null, projectKey: string): { readonly projectKey: string } | Response;
  /** The project's deployed file with template and overlay resolved. */
  deployedFile(projectKey: string): EffectiveResult;
  /** The instance's control database (the published templates) and clock, read when a request comes in. */
  publishContext(): { readonly control: Db; readonly clock: { now(): string } };
}

export interface AdminTemplatesCall {
  readonly request: Request;
  readonly principal: Principal | null;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const problem = (field: 'key' | 'version' | 'label', message: string) => ({ field, message });

export function createAdminTemplatesHandlers(deps: AdminTemplatesDeps) {
  return {
    async POST(call: AdminTemplatesCall): Promise<Response> {
      let body: unknown;
      try {
        body = await call.request.json();
      } catch {
        return jsonResponse({ error: 'The request body must be JSON.', problems: [] }, 400);
      }
      if (!isRecord(body) || typeof body['project'] !== 'string')
        return jsonResponse({ error: 'Send { "project", "key", "version", "label" }.', problems: [] }, 400);
      const auth = deps.authorizeAdmin(call.principal, body['project']);
      if (auth instanceof Response) return auth;
      const problems = [];
      const key = KeySchema.safeParse(body['key']);
      if (!key.success)
        problems.push(problem('key', 'Der Schlüssel hat die Form klein_geschrieben, z. B. baeume.'));
      const version = SemverSchema.safeParse(body['version']);
      if (!version.success) problems.push(problem('version', 'Eine Version hat die Form 1.0.0.'));
      const label = typeof body['label'] === 'string' ? body['label'].trim() : '';
      if (label === '') problems.push(problem('label', 'Der Name darf nicht leer sein.'));
      if (!key.success || !version.success || problems.length > 0)
        return jsonResponse({ error: 'The template cannot be published.', problems }, 400);
      const effective = deps.deployedFile(auth.projectKey);
      if (!effective.ok)
        return jsonResponse(
          {
            error: 'The project has no deployed version yet; publish it first.',
            code: effective.code,
            problems: [],
          },
          409,
        );
      const labelText: LocalizedString = { de: label, en: label };
      const file = templateFromProject(effective.file, {
        key: key.data,
        version: version.data,
        label: labelText,
      });
      const { control, clock } = deps.publishContext();
      const outcome = publishTemplateVersion(control, controlCatalog(control), clock, stringify(file));
      if (outcome.ok)
        return jsonResponse({ key: key.data, version: version.data, created: outcome.created }, 201);
      if (outcome.reason === 'failed')
        return jsonResponse({ error: 'The template cannot be published.', problems: [] }, 500);
      return jsonResponse(
        { error: 'The template cannot be published.', problems: [], messages: outcome.messages },
        outcome.reason === 'refused' ? 422 : 400,
      );
    },
  };
}
