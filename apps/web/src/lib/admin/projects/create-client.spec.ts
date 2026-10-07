import { describe, expect, it, vi } from 'vitest';
import { createProject, templateRef } from './create-client';

const values = { name: ' Baumkataster Nord ', description: 'x', template: 'baumkataster@1' };
const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('templateRef', () => {
  it('is key@major', () => {
    expect(templateRef({ key: 'leer', version: '1.0.0' })).toBe('leer@1');
    expect(templateRef({ key: 'baum', version: '2.3.1-rc1' })).toBe('baum@2');
  });
});

describe('createProject (POST /api/admin/projects, the one write path)', () => {
  it('posts name, description and template and answers the key of the new project', async () => {
    const fetcher = reply(201, { id: 'i', key: 'baumkataster_nord' });
    expect(await createProject(values, fetcher)).toEqual({ ok: true, key: 'baumkataster_nord' });
    expect(fetcher).toHaveBeenCalledWith('/api/admin/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });
  });

  it('an empty name is v3\'s "name is required" and nothing is sent', async () => {
    const fetcher = reply(201, {});
    const r = await createProject({ ...values, name: '   ' }, fetcher);
    expect(r).toEqual({ ok: false, problems: { name: { key: 'project_new_name_required' } } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('field problems of the server are shown per field', async () => {
    const fetcher = reply(400, {
      error: 'The project cannot be created.',
      problems: [{ field: 'template', message: 'Die Vorlage nope@1 gibt es nicht.' }],
    });
    expect(await createProject(values, fetcher)).toEqual({
      ok: false,
      problems: { template: { text: 'Die Vorlage nope@1 gibt es nicht.' } },
    });
  });

  it('any other failure, and a lost connection, is one form-level problem', async () => {
    expect(await createProject(values, reply(500, {}))).toEqual({
      ok: false,
      problems: { form: { key: 'project_new_failed' } },
    });
    const down = vi.fn(async () => {
      throw new TypeError('offline');
    });
    expect(await createProject(values, down)).toEqual({
      ok: false,
      problems: { form: { key: 'project_new_failed' } },
    });
  });
});
