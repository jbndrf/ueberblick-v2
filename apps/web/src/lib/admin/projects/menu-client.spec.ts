import { describe, expect, it } from 'vitest';
import {
  exportSchema,
  importProjectFile,
  publishAsTemplate,
  schemaFilename,
  suggestVersion,
} from './menu-client';

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }));
const T = (key: string, version: string) => ({ key, version, label: { de: key, en: key } });

describe('suggestVersion', () => {
  it('1.0.0 for a key nobody published, else the next minor of the newest version', () => {
    expect(suggestVersion([T('leer', '1.0.0')], 'meine')).toBe('1.0.0');
    expect(suggestVersion([T('meine', '1.2.0')], 'meine')).toBe('1.3.0');
    expect(suggestVersion([T('meine', '2.0.3')], 'meine')).toBe('2.1.0');
  });
});

describe('schemaFilename (v3: name lower-cased with dashes, then -schema)', () => {
  it('uses the project name', () => {
    expect(schemaFilename('Baumkataster Nord')).toBe('baumkataster-nord-schema.yaml');
  });
});

describe('publishAsTemplate', () => {
  const values = { project: 'baeume', key: 'meine', version: '1.0.0', label: 'Meine' };
  it('posts the dialog and returns the version', async () => {
    let sent: { url: string; body: unknown } | undefined;
    const r = await publishAsTemplate(values, (url, init) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return reply(201, { key: 'meine', version: '1.0.0', created: true });
    });
    expect(r).toEqual({ ok: true, key: 'meine', version: '1.0.0' });
    expect(sent).toEqual({ url: '/api/admin/templates', body: values });
  });
  it('field problems come back per field, refusals as a message', async () => {
    const fields = await publishAsTemplate(values, () =>
      reply(400, { problems: [{ field: 'key', message: 'Falsch' }] }),
    );
    expect(fields).toEqual({ ok: false, fields: { key: 'Falsch' }, message: null });
    const refused = await publishAsTemplate(values, () =>
      reply(422, { messages: ['1.0.0 is not higher than 1.0.0.'] }),
    );
    expect(refused).toEqual({ ok: false, fields: {}, message: '1.0.0 is not higher than 1.0.0.' });
    expect(await publishAsTemplate(values, () => Promise.reject(new Error('net')))).toEqual({
      ok: false,
      fields: {},
      message: null,
    });
  });
});

describe('importProjectFile', () => {
  const file = new File(['schema: ueberblick/1'], 'p.yaml');
  it('uploads the file as multipart and returns the key', async () => {
    let body: FormData | undefined;
    const r = await importProjectFile(file, (_url, init) => {
      body = init.body as FormData;
      return reply(201, { key: 'neu', id: 'x' });
    });
    expect(r).toEqual({ ok: true, key: 'neu' });
    expect((body?.get('file') as File).name).toBe('p.yaml');
  });
  it('problems are listed, nothing else', async () => {
    const r = await importProjectFile(file, () =>
      reply(422, { problems: [{ path: 'types.x', message: 'kaputt' }] }),
    );
    expect(r).toEqual({ ok: false, problems: [{ path: 'types.x', message: 'kaputt' }] });
    expect(await importProjectFile(file, () => reply(413, { error: 'big' }))).toMatchObject({
      ok: false,
      problems: [],
    });
  });
});

describe('exportSchema', () => {
  it('returns the YAML text, or the reason', async () => {
    expect(await exportSchema('baeume', () => reply(200, 'schema: x\n'))).toEqual({
      ok: true,
      text: 'schema: x\n',
    });
    expect(
      await exportSchema('baeume', () => reply(409, { problems: [{ path: 'a', message: 'b' }] })),
    ).toEqual({
      ok: false,
    });
  });
});
