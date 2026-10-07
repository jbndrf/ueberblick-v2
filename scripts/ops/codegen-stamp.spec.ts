import { mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  inputsHash,
  upToDate,
  writeStamp,
  runStep,
  withLock,
  paraglideStep,
  allSteps,
} from './codegen-stamp.mjs';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stamp-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const put = (name: string, text: string): string => {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
};

describe('codegen stamp', () => {
  it('same inputs are up to date', () => {
    const a = put('en.json', '{"a":1}');
    const out = put('out.js', '');
    const stamp = join(dir, 'stamps', 's');
    writeStamp(stamp, inputsHash([a]));
    expect(upToDate(stamp, inputsHash([a]), [out])).toBe(true);
  });

  it('a changed message is not up to date', () => {
    const a = put('en.json', '{"a":1}');
    const out = put('out.js', '');
    const stamp = join(dir, 's');
    writeStamp(stamp, inputsHash([a]));
    writeFileSync(a, '{"a":2}');
    expect(upToDate(stamp, inputsHash([a]), [out])).toBe(false);
  });

  it('a new or removed messages file is not up to date', () => {
    const a = put('en.json', '{}');
    const out = put('out.js', '');
    const stamp = join(dir, 's');
    writeStamp(stamp, inputsHash([a]));
    const b = put('de.json', '{}');
    expect(upToDate(stamp, inputsHash([a, b]), [out])).toBe(false);
    writeStamp(stamp, inputsHash([a, b]));
    expect(upToDate(stamp, inputsHash([a]), [out])).toBe(false);
  });

  it('the hash does not depend on the order of the files, but on path and content', () => {
    const a = put('a.json', 'x');
    const b = put('b.json', 'y');
    expect(inputsHash([a, b])).toBe(inputsHash([b, a]));
    expect(inputsHash([a], 'one')).not.toBe(inputsHash([a], 'two'));
  });

  it('a missing output is not up to date, and no stamp is not up to date', () => {
    const a = put('en.json', '{}');
    const stamp = join(dir, 's');
    expect(upToDate(stamp, inputsHash([a]), [])).toBe(false);
    writeStamp(stamp, inputsHash([a]));
    expect(upToDate(stamp, inputsHash([a]), [join(dir, 'missing.js')])).toBe(false);
  });

  it('the stamp write is atomic: no temp file is left and an existing stamp is replaced whole', () => {
    const stamp = join(dir, 'stamps', 's');
    writeStamp(stamp, 'one');
    writeStamp(stamp, 'two');
    expect(readdirSync(join(dir, 'stamps'))).toEqual(['s']);
    const a = put('en.json', '');
    expect(upToDate(stamp, 'two', [a])).toBe(true);
  });

  it('runStep runs once, then skips; UEB_CODEGEN_FORCE=1 forces it', async () => {
    const a = put('en.json', '{}');
    let runs = 0;
    const out = join(dir, 'out.js');
    const step = {
      name: 'demo',
      inputs: () => ({ files: [a] }),
      outputs: [out],
      run: async () => {
        runs += 1;
        writeFileSync(out, '');
      },
    };
    expect(await runStep(step, dir)).toBe('ran');
    expect(await runStep(step, dir)).toBe('skipped');
    process.env.UEB_CODEGEN_FORCE = '1';
    try {
      expect(await runStep(step, dir)).toBe('ran');
    } finally {
      delete process.env.UEB_CODEGEN_FORCE;
    }
    expect(runs).toBe(2);
  });

  it('a failing step fails loudly and writes no stamp', async () => {
    const a = put('en.json', '{}');
    const step = {
      name: 'bad',
      inputs: () => ({ files: [a] }),
      outputs: [],
      run: async () => {
        throw new Error('compile failed');
      },
    };
    await expect(runStep(step, dir)).rejects.toThrow('compile failed');
    expect(existsSync(join(dir, 'node_modules/.cache/codegen-stamps/bad'))).toBe(false);
  });

  it('two concurrent runners compile once (lock, then re-check the stamp)', async () => {
    const a = put('en.json', '{}');
    let runs = 0;
    const out = join(dir, 'out.js');
    const step = {
      name: 'race',
      inputs: () => ({ files: [a] }),
      outputs: [out],
      run: async () => {
        runs += 1;
        await new Promise((r) => setTimeout(r, 50));
        writeFileSync(out, '');
      },
    };
    await Promise.all([runStep(step, dir), runStep(step, dir)]);
    expect(runs).toBe(1);
  });

  it('withLock serialises and releases the lock', async () => {
    const lock = join(dir, 'l.lock');
    const order: string[] = [];
    await Promise.all(
      ['a', 'b'].map((n) =>
        withLock(lock, async () => {
          order.push(`${n}0`);
          await new Promise((r) => setTimeout(r, 20));
          order.push(`${n}1`);
        }),
      ),
    );
    expect(order.map((o) => o[0])).toEqual([order[0]?.[0], order[0]?.[0], order[2]?.[0], order[2]?.[0]]);
    expect(existsSync(lock)).toBe(false);
  });

  it('a stale lock (old mtime) is taken over', async () => {
    const lock = join(dir, 'stale.lock');
    mkdirSync(lock);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    let ran = false;
    await withLock(
      lock,
      async () => {
        ran = true;
      },
      { staleMs: 1000 },
    );
    expect(ran).toBe(true);
  });

  it('a fresh lock is waited for, not taken over', async () => {
    const lock = join(dir, 'fresh.lock');
    mkdirSync(lock);
    let ranAt = 0;
    const start = Date.now();
    setTimeout(() => rmSync(lock, { recursive: true, force: true }), 200);
    await withLock(
      lock,
      async () => {
        ranAt = Date.now() - start;
      },
      { staleMs: 5000 },
    );
    expect(ranAt).toBeGreaterThanOrEqual(190);
  });

  it('a step longer than the stale limit keeps its lock (the mtime is refreshed while it runs)', async () => {
    const lock = join(dir, 'long.lock');
    const events: string[] = [];
    // Margins sized for a loaded land train (60 workers): the refresh every staleMs/3 may come up to 2/3 of the limit late.
    const opts = { staleMs: 800, pollMs: 10 };
    const first = withLock(
      lock,
      async () => {
        events.push('a0');
        await new Promise((r) => setTimeout(r, 2000));
        events.push('a1');
      },
      opts,
    );
    await new Promise((r) => setTimeout(r, 20));
    const second = withLock(
      lock,
      async () => {
        events.push('b0');
      },
      opts,
    );
    await Promise.all([first, second]);
    expect(events).toEqual(['a0', 'a1', 'b0']);
  });
});

describe('paraglide step inputs', () => {
  const fixture = (version: string, modules: string[]): ReturnType<typeof paraglideStep> => {
    const root = join(dir, 'root');
    const project = join(root, 'pkg/project.inlang');
    mkdirSync(project, { recursive: true });
    mkdirSync(join(root, 'pkg/messages'), { recursive: true });
    writeFileSync(join(root, 'pkg/messages/en.json'), '{}');
    mkdirSync(join(root, 'node_modules/@inlang/paraglide-js'), { recursive: true });
    writeFileSync(join(root, 'node_modules/@inlang/paraglide-js/package.json'), '{"version":"1"}');
    mkdirSync(join(root, 'node_modules/plugin-x/dist'), { recursive: true });
    writeFileSync(join(root, 'node_modules/plugin-x/package.json'), `{"version":"${version}"}`);
    writeFileSync(join(root, 'node_modules/plugin-x/dist/index.js'), '');
    writeFileSync(
      join(project, 'settings.json'),
      JSON.stringify({
        locales: ['en'],
        modules,
        'plugin.inlang.messageFormat': { pathPattern: './messages/{locale}.json' },
      }),
    );
    return paraglideStep('pkg/project.inlang', 'pkg/out', root);
  };
  const hashOf = (step: ReturnType<typeof paraglideStep>): string => {
    const { files, extra } = step.inputs();
    return inputsHash(files, extra);
  };

  it('a plugin module version change is not up to date', () => {
    const mod = ['../../node_modules/plugin-x/dist/index.js'];
    const before = hashOf(fixture('1.0.0', mod));
    expect(hashOf(fixture('1.0.0', mod))).toBe(before);
    expect(hashOf(fixture('1.1.0', mod))).not.toBe(before);
  });

  it('a module given as a URL is hashed as the URL string', () => {
    const a = hashOf(fixture('1.0.0', ['https://cdn.example/plugin@1/index.js']));
    const b = hashOf(fixture('1.0.0', ['https://cdn.example/plugin@2/index.js']));
    expect(a).not.toBe(b);
  });
});

describe('step list', () => {
  it('covers ui, builder, every tool and web, plus kit sync', () => {
    const names = allSteps(join(__dirname, '../..')).map((s: { name: string }) => s.name);
    for (const n of ['ui', 'builder', 'chat', 'draw', 'file', 'measure', 'photo', 'search', 'apps-web']) {
      expect(names.some((x: string) => x.includes(n))).toBe(true);
    }
    expect(names).toContain('svelte-kit-sync');
  });
});
