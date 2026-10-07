// A-036: the project icon named by the deployed config's `branding.icon` is readable by every participant.
import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '@ueberblick/core';
import { createConfigResolver, createVersionCache } from '../../store/run/config-for';
import { actor, build, setup } from '../../store/run/testkit';
import { createBlobAccess } from './access';

const ICON = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);
const template = {
  schema: 'ueberblick/1',
  template: { key: 'brand', version: '1.0.0' },
  roles: { melder: { label: 'Melder' } },
  types: { meldung: { label: 'Meldung', permissions: { see: ['melder'] }, properties: {} } },
} as unknown as TemplateFile;

function world(icon: string | undefined) {
  const config = build(template);
  const c = setup({ config, version: 1, deployed: 1 });
  const versions = createConfigResolver(
    c.db,
    createVersionCache((v) => (v === 1 ? config : undefined)),
  );
  return createBlobAccess({
    db: c.db,
    clock: c.deps.clock,
    deployed: () => 1,
    versions,
    configBlobs: () => (icon === undefined ? [] : [icon]),
  });
}

describe('config-referenced blobs', () => {
  it('lets any participant read the deployed icon, and nothing else', () => {
    const access = world(ICON);
    expect(access.allowed(actor('participant', 'p', ['melder']), ICON)).toBe(true);
    expect(access.allowed(actor('participant', 'q', []), ICON)).toBe(true);
    expect(access.allowed(actor('participant', 'p', ['melder']), OTHER)).toBe(false);
  });
  it('without a branding icon nothing is opened', () => {
    expect(world(undefined).allowed(actor('participant', 'p', ['melder']), ICON)).toBe(false);
  });
});
