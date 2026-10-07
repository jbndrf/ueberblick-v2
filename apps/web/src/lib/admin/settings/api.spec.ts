import { describe, expect, it, vi } from 'vitest';
import { createSettingsApi } from './api';

const upload = { tooLarge: 'zu groß', badType: 'kein Bild', fallback: 'Upload fehlgeschlagen' };
const api = (fetch: typeof globalThis.fetch) =>
  createSettingsApi({ project: 'muster stadt', language: 'de', fetch, fallback: 'Fehler', upload });
const reply = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });

describe('the settings api', () => {
  it('posts a branding save to the page route and returns what the page shows now', async () => {
    const data = { projectName: 'M', branding: { name: 'X', icon: null }, map: {} };
    const f = reply(200, data);
    const r = await api(f as never).saveBranding({ name: 'X' });
    expect(r).toEqual({ ok: true, value: data });
    expect(f).toHaveBeenCalledWith(
      '/admin/projects/muster%20stadt/settings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'branding', name: 'X' }),
      }),
    );
  });
  it('posts the map values', async () => {
    const f = reply(200, {});
    await api(f as never).saveMap({ lat: 1, lng: 2, zoom: 3, minZoom: 0, maxZoom: 5 });
    expect(JSON.parse(f.mock.calls[0]?.[1]?.body as string)).toEqual({
      action: 'map',
      lat: 1,
      lng: 2,
      zoom: 3,
      minZoom: 0,
      maxZoom: 5,
    });
  });
  it('posts the chat switch and roles', async () => {
    const f = reply(200, {});
    await api(f as never).saveChat({ enabled: true, roles: ['melder'] });
    expect(JSON.parse(f.mock.calls[0]?.[1]?.body as string)).toEqual({
      action: 'chat',
      enabled: true,
      roles: ['melder'],
    });
  });
  it('shows the refusal in the page language, else the fallback', async () => {
    const refused = reply(409, { message: { de: 'Entwurf geändert', en: 'Draft changed' } });
    expect(await api(refused as never).saveBranding({})).toEqual({ ok: false, message: 'Entwurf geändert' });
    expect(await api(reply(500, {}) as never).saveBranding({})).toEqual({ ok: false, message: 'Fehler' });
    const offline = vi.fn(async () => Promise.reject(new Error('offline')));
    expect(await api(offline as never).saveBranding({})).toEqual({ ok: false, message: 'Fehler' });
  });
  it('uploads the file as the body with its own type, and returns the sha', async () => {
    const asset = { sha256: 'a'.repeat(64), bytes: 3, mime: 'image/png' };
    const f = reply(201, asset);
    expect(await api(f as never).uploadIcon(file)).toEqual({ ok: true, value: asset });
    expect(f).toHaveBeenCalledWith(
      '/api/admin/p/muster%20stadt/assets',
      expect.objectContaining({ method: 'POST', headers: { 'content-type': 'image/png' }, body: file }),
    );
  });
  it('maps the typed upload refusals to their messages', async () => {
    const big = reply(413, { error: { code: 'payload_too_large' } });
    expect(await api(big as never).uploadIcon(file)).toEqual({ ok: false, message: 'zu groß' });
    const bad = reply(400, { error: { code: 'invalid_body' } });
    expect(await api(bad as never).uploadIcon(file)).toEqual({ ok: false, message: 'kein Bild' });
    const denied = reply(403, { error: 'no' });
    expect(await api(denied as never).uploadIcon(file)).toEqual({
      ok: false,
      message: 'Upload fehlgeschlagen',
    });
  });
});

describe('the tokens and danger zone calls (WP-388)', () => {
  it('lists, creates and revokes tokens on the project endpoint', async () => {
    const list = reply(200, { tokens: [{ id: 't' }] });
    expect(await api(list as never).listTokens()).toEqual({ ok: true, value: [{ id: 't' }] });
    expect(list.mock.calls[0]?.[0]).toBe('/api/admin/p/muster%20stadt/tokens');
    const made = reply(201, { token: 'ubk_x', info: {} });
    await api(made as never).createToken({ participant: 'anna', label: 'L' });
    expect(made.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ participant: 'anna', label: 'L' }),
    });
    const gone = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    expect(await api(gone as never).revokeToken('a/b')).toEqual({ ok: true, value: null });
    expect(gone.mock.calls[0]?.[0]).toBe('/api/admin/p/muster%20stadt/tokens/a%2Fb');
    expect(await api(reply(404, {}) as never).revokeToken('x')).toEqual({ ok: false, message: 'Fehler' });
  });
  it('reads the counts and deletes with the typed key', async () => {
    const counts = reply(200, { types: 1 });
    expect(await api(counts as never).deleteCounts()).toEqual({ ok: true, value: { types: 1 } });
    expect(counts.mock.calls[0]?.[0]).toBe('/api/admin/projects/muster%20stadt');
    const gone = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await api(gone as never).deleteProject('muster stadt');
    expect(gone.mock.calls[0]?.[1]).toMatchObject({
      method: 'DELETE',
      body: JSON.stringify({ confirm: 'muster stadt' }),
    });
    expect(await api(reply(400, {}) as never).deleteProject('x')).toEqual({ ok: false, message: 'Fehler' });
  });
});
