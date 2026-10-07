/**
 * The projects an admin account looks after (WP-323, E-1): the data of the Projekte page and
 * `GET /api/admin/projects`. One control query plus one small query per project (its deployed version).
 */
import type { Db } from '../db/driver';
import { deployedVersion } from '../deploy';

export interface ProjectListing {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly createdAt: string;
  /** `key@version` of the deployed version's template; null while nothing is deployed or the version has no template or no version. */
  readonly template: string | null;
  /** True once a version is deployed (nothing is live before the first deploy). */
  readonly published: boolean;
}

/** Member projects, newest first (v3 sorted `-created`). `openProjectDb` is the lazy per-project opener. */
export function listProjects(
  control: Db,
  openProjectDb: (key: string) => Db,
  accountId: string,
): readonly ProjectListing[] {
  const rows = control
    .prepare<{ id: string; key: string; name: string; description: string; created_at: string }>(
      `SELECT p.id AS id, p.key AS key, p.name AS name, p.description AS description, p.created_at AS created_at
       FROM memberships m JOIN projects p ON p.id = m.project_id
       WHERE m.account_id = ? ORDER BY p.created_at DESC, p.key`,
    )
    .all(accountId);
  return rows.map((r) => {
    const v = deployedVersion(openProjectDb(r.key));
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      createdAt: r.created_at,
      template: v?.template && v.templateVersion ? `${v.template}@${v.templateVersion}` : null,
      published: v !== undefined,
    };
  });
}
