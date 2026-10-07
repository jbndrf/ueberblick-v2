import { describe, expect, it } from 'vitest';
import type { Principal } from '@ueberblick/server';
import { createProjectsHandlers, type ProjectsDeps } from './projects';

const admin = { kind: 'admin', id: 'acc-1' } as unknown as Principal;
const deps = (): ProjectsDeps & { created: unknown[] } => {
  const created: unknown[] = [];
  return {
    created,
    validate: (i) =>
      i.name.trim() === ''
        ? [{ field: 'name', message: 'Name fehlt.' }]
        : i.template === 'nope@1'
          ? [{ field: 'template', message: 'Unbekannt.' }]
          : [],
    create: (i, by) => {
      created.push([i, by]);
      return { id: 'p1', key: 'musterstadt' };
    },
    templates: () => [
      { key: 'leer', version: '1.0.0', label: { de: 'Leeres Projekt', en: 'Empty project' } },
    ],
  };
};
const post = (
  h: ReturnType<typeof createProjectsHandlers>,
  body: unknown,
  principal: Principal | null = admin,
) =>
  h.POST({
    locals: { admin: principal },
    request: new Request('http://x/api/admin/projects', { method: 'POST', body: JSON.stringify(body) }),
  });

describe('POST /api/admin/projects', () => {
  it('201 with id and key for valid input; the creator is the signed-in account', async () => {
    const d = deps();
    const r = await post(createProjectsHandlers(d), { name: 'Muster', description: 'd', template: 'leer@1' });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ id: 'p1', key: 'musterstadt' });
    expect(d.created[0]).toEqual([{ name: 'Muster', description: 'd', template: 'leer@1' }, 'acc-1']);
  });
  it('400 for an empty name or unknown template, with field problems', async () => {
    const h = createProjectsHandlers(deps());
    const a = await post(h, { name: '', description: '', template: 'leer@1' });
    expect(a.status).toBe(400);
    expect(((await a.json()) as { problems: { field: string }[] }).problems[0]?.field).toBe('name');
    expect((await post(h, { name: 'x', description: '', template: 'nope@1' })).status).toBe(400);
    expect((await post(h, { name: 5 })).status).toBe(400);
  });
  it('401 without a session, 403 for a participant', async () => {
    const h = createProjectsHandlers(deps());
    expect((await post(h, {}, null)).status).toBe(401);
    expect((await post(h, {}, { kind: 'participant' } as unknown as Principal)).status).toBe(403);
  });
});

describe('GET /api/admin/templates', () => {
  it('lists templates for an admin, 401 without a session', async () => {
    const h = createProjectsHandlers(deps());
    const r = h.GET_TEMPLATES({ locals: { admin: admin } });
    expect(((await r.json()) as { key: string }[])[0]?.key).toBe('leer');
    expect(h.GET_TEMPLATES({ locals: { admin: null } }).status).toBe(401);
  });
});
