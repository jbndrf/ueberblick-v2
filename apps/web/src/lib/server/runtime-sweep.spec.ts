import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime, type Runtime } from './runtime';

const dirs: string[] = [];
const runtimes: Runtime[] = [];
afterEach(() => {
  runtimes.splice(0).forEach((r) => r.stop());
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const start = (dir: string): Runtime => {
  const rt = createRuntime({ dataDir: dir, secureCookies: false, sink: () => undefined });
  runtimes.push(rt);
  return rt;
};

describe('orphan files of deleted projects (A-037, WP-404)', () => {
  it('a start removes the files of a retired key and leaves other keys alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ub-sweep-'));
    dirs.push(dir);
    start(dir).control.prepare("INSERT INTO retired_projects (key, retired_at) VALUES ('alt','x')").run();
    runtimes.splice(0).forEach((r) => r.stop());
    for (const key of ['alt', 'frei']) {
      mkdirSync(join(dir, 'blobs', key), { recursive: true });
      writeFileSync(join(dir, `project-${key}.db`), 'x');
    }
    const again = start(dir);
    expect(readdirSync(dir)).not.toContain('project-alt.db');
    expect(readdirSync(join(dir, 'blobs'))).toEqual(['frei']);
    expect(readdirSync(dir)).toContain('project-frei.db');
    expect(again.control.prepare('SELECT key FROM retired_projects').all()).toHaveLength(1);
  });
});
