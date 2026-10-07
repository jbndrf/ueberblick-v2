import { describe, expect, it } from 'vitest';
import { createAuth } from '../auth';
import { openControlDb, openProjectDb } from '../db/open';
import { createProjectFromTemplate } from './create-project';
import { listProjects } from './list-projects';

const clockAt = (iso: string) => ({ now: () => iso });

async function world() {
  const control = openControlDb(':memory:');
  const auth = createAuth({ control, now: () => new Date(0), participantRoles: () => [] });
  const a = await auth.createAdmin('a@example.org', 'correct horse battery');
  const b = await auth.createAdmin('b@example.org', 'correct horse battery');
  const dbs = new Map<string, ReturnType<typeof openProjectDb>>();
  const opener = (key: string) => {
    let db = dbs.get(key);
    if (!db) dbs.set(key, (db = openProjectDb(':memory:', key)));
    return db;
  };
  return { control, a, b, opener };
}
const input = (name: string) => ({ name, description: `${name} beschrieben`, template: 'leer@1' });

describe('listProjects', () => {
  it('returns only the projects the account is a member of', async () => {
    const { control, a, b, opener } = await world();
    createProjectFromTemplate(control, opener, input('Eins'), a, clockAt('2026-10-01T08:00:00Z'));
    createProjectFromTemplate(control, opener, input('Zwei'), b, clockAt('2026-10-01T09:00:00Z'));
    const list = listProjects(control, opener, a);
    expect(list.map((p) => p.name)).toEqual(['Eins']);
    expect(listProjects(control, opener, 'nobody')).toEqual([]);
  });

  it('a new project is unpublished with no template; the description and key are returned', async () => {
    const { control, a, opener } = await world();
    const made = createProjectFromTemplate(
      control,
      opener,
      input('Eins'),
      a,
      clockAt('2026-10-01T08:00:00Z'),
    );
    expect(listProjects(control, opener, a)).toEqual([
      {
        id: made.id,
        key: made.key,
        name: 'Eins',
        description: 'Eins beschrieben',
        createdAt: '2026-10-01T08:00:00Z',
        template: null,
        published: false,
      },
    ]);
  });

  it('orders newest first (v3: sort -created) and reads the deployed version', async () => {
    const { control, a, opener } = await world();
    const old = createProjectFromTemplate(control, opener, input('Alt'), a, clockAt('2026-09-01T08:00:00Z'));
    createProjectFromTemplate(control, opener, input('Neu'), a, clockAt('2026-10-01T08:00:00Z'));
    opener(old.key)
      .prepare(
        `INSERT INTO config_versions (version, schema, template, template_version, overlay, compiled, hash, status, created_at)
         VALUES (1, 'ueberblick/1', 'baumkataster', '1.2.0', '', '{}', 'h', 'deployed', 'x')`,
      )
      .run();
    const list = listProjects(control, opener, a);
    expect(list.map((p) => p.name)).toEqual(['Neu', 'Alt']);
    expect(list[1]).toMatchObject({ published: true, template: 'baumkataster@1.2.0' });
    expect(list[0]).toMatchObject({ published: false, template: null });
  });

  it('a deployed version without a stored template_version lists template: null (no invented key@)', async () => {
    const { control, a, opener } = await world();
    const made = createProjectFromTemplate(
      control,
      opener,
      input('Eins'),
      a,
      clockAt('2026-10-01T08:00:00Z'),
    );
    opener(made.key)
      .prepare(
        `INSERT INTO config_versions (version, schema, template, template_version, overlay, compiled, hash, status, created_at)
         VALUES (1, 'ueberblick/1', 'baumkataster', NULL, '', '{}', 'h', 'deployed', 'x')`,
      )
      .run();
    expect(listProjects(control, opener, a)).toEqual([
      expect.objectContaining({ key: made.key, published: true, template: null }),
    ]);
  });
});
