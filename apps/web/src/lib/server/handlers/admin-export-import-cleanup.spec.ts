import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { projectDbPath, type Principal } from '@ueberblick/server';
import { golden } from '../../../../../../packages/server/src/store/run/testkit';
import { zipStream } from '../../../../../../packages/server/src/io/archive/zip';
import type { Call } from './http';
import type * as Export from './admin-export';
import type * as Runtime from '../runtime';

// The REAL import over the real runtime (WP-424): a ZIP that breaks after its project was created leaves no project.
const dir = mkdtempSync(join(tmpdir(), 'ub-import-cleanup-'));
let handlers: (typeof Export)['adminExportHandlers'];
let rt: ReturnType<(typeof Runtime)['runtime']>;
let admin: Principal;

beforeAll(async () => {
  process.env['PUBLIC_URL'] = 'http://localhost:3000';
  process.env['DATA_DIR'] = dir;
  process.env['TIMERS_INTERVAL_S'] = '0';
  rt = (await import('../runtime')).runtime();
  handlers = (await import('./admin-export')).adminExportHandlers;
  const id = await rt.auth.createAdmin('a@example.org', 'correct horse battery');
  admin = { kind: 'admin', id, projectId: null, roles: [] };
});
afterAll(() => {
  rt.stop();
  rmSync(dir, { recursive: true, force: true });
});

const text = (s: string): AsyncGenerator<Uint8Array> =>
  (async function* () {
    yield Buffer.from(s);
  })();

async function zip(dataLine: string): Promise<Buffer> {
  const manifest = {
    format: 'ueberblick-project-zip',
    version: 1,
    exportedAt: 'x',
    project: { key: 'a', name: 'a', description: '' },
    deployed: true,
    types: { baum: { count: 1 } },
    blobs: { count: 0, bytes: 0 },
  };
  const parts: Buffer[] = [];
  for await (const c of zipStream([
    { name: 'manifest.json', data: text(JSON.stringify(manifest)) },
    { name: 'project.yaml', data: text(stringify(golden('musterstadt-plain').file)) },
    { name: 'data/baum.ndjson', data: text(dataLine) },
  ]))
    parts.push(Buffer.from(c));
  return Buffer.concat(parts);
}

const call = (params: Record<string, string>, body?: Buffer): Call =>
  ({
    locals: { admin },
    params,
    request: new Request('http://localhost:3000/x', {
      method: body ? 'POST' : 'GET',
      ...(body ? { body: new Blob([new Uint8Array(body)]) } : {}),
    }),
    getClientAddress: () => '127.0.0.1',
  }) as unknown as Call;

const projects = (): string[] =>
  rt.control
    .prepare<{ key: string }>('SELECT key FROM projects')
    .all()
    .map((r) => r.key);

const retiredKeys = (): string[] =>
  rt.control
    .prepare<{ key: string }>('SELECT key FROM retired_projects')
    .all()
    .map((r) => r.key);

describe('a failed ZIP import', () => {
  it('removes the project it created (control rows and files) and tells the admin why', async () => {
    const retiredBefore = retiredKeys();
    const started = await handlers.importZip(call({}, await zip('this is not json\n')));
    const { job } = (await started.json()) as { job: string };
    let state: { state: string; key?: string; problems?: { message: string }[] } = { state: 'queued' };
    for (let i = 0; i < 400 && state.state !== 'failed' && state.state !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 25));
      state = ((await handlers.importZipStatus(call({ job })).json()) as { job: typeof state }).job;
    }
    expect(state.state).toBe('failed');
    expect(state.key).toBeUndefined();
    expect(state.problems?.[0]?.message).not.toBe('');
    expect(projects()).toEqual([]);
    const fresh = retiredKeys().filter((k) => !retiredBefore.includes(k));
    expect(fresh).toHaveLength(1);
    expect(existsSync(projectDbPath(dir, fresh[0] ?? ''))).toBe(false);
  });
});
