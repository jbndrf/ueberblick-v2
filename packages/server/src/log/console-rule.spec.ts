import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withPlants } from '../../../../scripts/testing/plant.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = 'packages/server/src/consoleprobe.planted';

const BAD: Record<string, string> = {
  'dot.planted.ts': "console.log('x');\n",
  'bracket.planted.ts': "console['log']('x');\n",
  'alias.planted.ts': "const c = console;\nc.log('x');\n",
  'destructure.planted.ts': "const { log } = console;\nlog('x');\n",
  'globalthis.planted.ts': "globalThis.console.log('x');\n",
  'global.planted.ts': "global.console.log('x');\n",
  'self.planted.ts': "self.console.log('x');\n",
};
const OK = {
  'comment.planted.ts': "// console.log('x')\nexport const s = 'console.log(x)';\n",
};

// WP-152: each case plants its one file for its own eslint call only (WP-143), never for the whole spec.
const lint = (files: Record<string, string>, file: string): { ok: boolean; out: string } => {
  const r = withPlants(root, files, () =>
    spawnSync('npx', ['eslint', '--no-ignore', file], { cwd: root, encoding: 'utf8' }),
  );
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
};

describe('console guardrail via ESLint (WP-537)', () => {
  it.each(Object.keys(BAD))(
    'flags %s',
    (name) => {
      const r = lint({ [`${dir}/${name}`]: BAD[name] ?? '' }, `${dir}/${name}`);
      expect(r.ok).toBe(false);
      expect(r.out).toMatch(/no-restricted-(globals|properties)/);
    },
    60_000,
  );

  it('ignores comments and strings', () => {
    expect(
      lint({ [`${dir}/comment.planted.ts`]: OK['comment.planted.ts'] }, `${dir}/comment.planted.ts`).ok,
    ).toBe(true);
  }, 60_000);

  it('allows the log module itself', () => {
    const file = 'packages/server/src/log/inlog.planted.ts';
    expect(lint({ [file]: "console.info('ok');\n" }, file).ok).toBe(true);
  }, 60_000);
});
