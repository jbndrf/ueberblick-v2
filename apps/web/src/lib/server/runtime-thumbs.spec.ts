import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { Key, RunId } from '@ueberblick/core';
import {
  blobHandlersFor,
  createBlobs,
  deploy,
  isAuthError,
  projectStoresFor,
  sessionCookie,
} from '@ueberblick/server';
import { createRuntime, type Runtime } from './runtime';

/** A tiny project: a report with a photo. */
const template = {
  schema: 'ueberblick/1',
  template: { key: 'thumb_demo', version: '1.0.0' },
  roles: { melder: { label: 'Melder' } },
  types: {
    meldung: {
      label: 'Meldung',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { foto: { type: 'file' } },
    },
  },
  tasks: {
    melden: { label: 'Melden', who: ['melder'], on: '$none', creates: 'meldung', form: { foto: {} } },
  },
} as unknown as Parameters<typeof deploy>[1];

const dirs: string[] = [];
const runtimes: Runtime[] = [];
afterEach(() => {
  runtimes.splice(0).forEach((r) => r.stop());
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('photo thumbnails through the runtime (WP-708)', () => {
  it('knows its data dir, so ?thumb=list|preview on a stored photo answers an image, not 404', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ub-runtime-thumbs-'));
    dirs.push(dir);
    const rt = createRuntime({
      dataDir: dir,
      secureCookies: false,
      now: () => new Date('2026-03-01T08:00:00.000Z'),
    });
    runtimes.push(rt);
    rt.control
      .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
      .run('p1', 'demo', 'demo', 'x');
    expect(rt.dataDir).toBe(dir);
    const db = rt.projectDb('demo');
    deploy(db, template, 'admin', { clock: rt.clock });
    db.prepare('INSERT INTO participants (id, name, roles) VALUES (?,?,?)').run('anna', 'Anna', '["melder"]');
    rt.control
      .prepare('INSERT INTO credentials (token, project_id, participant_id) VALUES (?,?,?)')
      .run('T', 'p1', 'anna');
    const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#468' } })
      .jpeg()
      .toBuffer();
    const { sha256 } = await createBlobs({ db, store: rt.blobs.store('demo'), clock: rt.clock }).put(
      (async function* () {
        yield jpeg;
      })(),
      'image/jpeg',
    );
    db.prepare(
      "INSERT INTO blob_uploads (sha256, actor, actor_kind, created_at) VALUES (?, 'anna', 'participant', 'x')",
    ).run(sha256);
    const anna = { id: 'anna', kind: 'participant' as const, roles: ['melder' as Key] };
    const run = {
      id: '00000000-0000-7000-8000-000000000001' as RunId,
      task: 'melden' as Key,
      actor: anna,
      configVersion: 1,
      input: { foto: [{ sha256, name: 'a.jpg', mime: 'image/jpeg' }] },
    };
    expect(projectStoresFor(rt)('demo').submit(run).outcome).toBe('accepted');
    const s = rt.auth.exchange('T');
    if (isAuthError(s)) throw new Error(s.code);
    const handlers = blobHandlersFor(rt);
    for (const size of ['list', 'preview']) {
      const res = await handlers.get(
        new Request(`http://x/api/p/demo/blobs/${sha256}?thumb=${size}`, {
          headers: { cookie: sessionCookie('participant', s) },
        }),
        { params: { project: 'demo', sha: sha256 } },
      );
      expect(res.status, size).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/webp');
    }
  });
});
