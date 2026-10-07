// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Device } from '../device';
import { fieldToolHost } from './field-tools';

// Field tools (photo, file, draw) are form inputs that are always on, as in v3; only panel tools follow the
// role and person switches (WP-743 decision). A role whose `app.tools` does not list `photo` still gets a photo field.
describe('fieldToolHost', () => {
  it('mounts a photo field for a role whose app.tools does not list photo', async () => {
    const file = {
      roles: { feld: { app: { tools: { chat: { availability: 'active' } } } } },
    };
    const device = {
      config: { file, foldTypes: new Map() },
      geo: undefined,
      blobs: { put: async () => undefined, get: async () => undefined },
      roleKey: 'feld',
    } as unknown as Pick<Device, 'config' | 'geo' | 'blobs' | 'roleKey'>;
    const host = fieldToolHost(device, undefined, 'en', () => undefined);
    const root = document.createElement('div');
    document.body.append(root);
    const handle = await host.mountField(root, {
      toolKey: 'photo',
      field: { key: 'foto', id: 'f-foto', label: 'Photo', type: 'file' },
      value: undefined,
      onproduce: () => undefined,
      onclear: () => undefined,
    });
    expect(root.childElementCount).toBeGreaterThan(0);
    handle.destroy();
  });
});
