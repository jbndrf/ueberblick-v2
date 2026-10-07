// `task_field_not_writable`: a form field that no role in the task's audience may write (WP-011.2).
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compile } from './index';
import { TemplateFileSchema, type TemplateFile } from '../file';
import { goldenAssets } from '../../testing/golden';
import fc from 'fast-check';
import type { Key } from '../../model';
import { compilePerms, roleSubject } from '../../perms';

const raw = import.meta.glob('./__fixtures__/base.yaml', { query: '?raw', import: 'default', eager: true });
const base = parse(Object.values(raw)[0] as string) as Record<string, unknown>;

/** base.yaml with `types.baum.permissions.write` and the `kontrolle` task `who` replaced. */
function variant(write: unknown, who?: readonly string[]): TemplateFile {
  const f = structuredClone(base) as {
    types: { baum: { permissions: Record<string, unknown> } };
    tasks: { kontrolle: { who?: readonly string[]; when?: string } };
  };
  f.types.baum.permissions.write = write;
  if (who !== undefined) f.tasks.kontrolle.who = who;
  return TemplateFileSchema.parse(f);
}
const found = (f: TemplateFile) => {
  const r = compile(f, { assets: goldenAssets });
  return (r.ok ? r.warnings : r.problems).filter((p) => p.code === 'task_field_not_writable');
};

const foundRole = (f: TemplateFile) => {
  const r = compile(f, { assets: goldenAssets });
  return (r.ok ? r.warnings : r.problems).filter((p) => p.code === 'task_role_cannot_write');
};

describe('compile: task_field_not_writable', () => {
  it('skips a computed property in a form (display-only, never written; WP-822)', () => {
    const f = structuredClone(variant({ vitalitaet: ['kontrolle'], foto: ['kontrolle'] })) as TemplateFile;
    const befund = f.types?.baum?.properties.befund;
    if (befund === undefined) throw new Error('fixture lost befund');
    Object.assign(befund, { computed: "self.vitalitaet == 'x' ? 'a' : 'b'" });
    expect(compile(f, { assets: goldenAssets }).ok).toBe(true);
    expect(found(f)).toEqual([]);
    expect(foundRole(f)).toEqual([]);
  });
  it('a computed step property is refused as computed_written, never as not-writable; a plain one is task_field_not_writable (WP-860)', () => {
    // Unlike a form field, a quick-edit/location property is a write: the computed skip in writable.ts is only
    // reached for forms, and the computed step property is a compile error (computed.ts checkWrites).
    const steps = (computed: boolean): TemplateFile => {
      const f = structuredClone(variant({ vitalitaet: ['kontrolle'], foto: ['kontrolle'] })) as TemplateFile;
      const task = f.tasks?.kontrolle;
      const befund = f.types?.baum?.properties.befund;
      if (task === undefined || befund === undefined) throw new Error('fixture lost kontrolle/befund');
      delete task.form;
      Object.assign(task, { steps: [{ kind: 'quick_edit', properties: ['befund'] }] });
      if (computed) Object.assign(befund, { computed: "self.vitalitaet == 'x' ? 'a' : 'b'" });
      return f;
    };
    expect(found(steps(false)).map((p) => p.path)).toEqual(['tasks.kontrolle.steps']);
    const r = compile(steps(true), { assets: goldenAssets });
    expect(r.ok).toBe(false);
    const codes = (r.ok ? [] : r.problems).map((p) => p.code);
    expect(codes).toContain('computed_written');
    expect(codes).not.toContain('task_field_not_writable');
  });
  it('warns with the path of the task field when the write map omits it', () => {
    const w = found(variant({ vitalitaet: ['kontrolle'], foto: ['kontrolle'] }));
    expect(w.map((p) => p.path)).toEqual(['tasks.kontrolle.form.befund']);
    expect(w[0]?.message).toMatch(/befund/);
    expect(w[0]?.hint).toMatch(/write/);
  });
  it('warns when the type has no write permission at all (absent denies, F6)', () => {
    expect(found(variant(undefined)).length).toBe(3);
  });
  it('warns when only a role outside the audience may write', () => {
    expect(found(variant({ vitalitaet: ['bauhof'], befund: ['bauhof'], foto: ['bauhof'] })).length).toBe(3);
  });
  it('is silent for `$all`, the list form and a per-property map', () => {
    expect(found(variant('$all'))).toEqual([]);
    expect(found(variant(['kontrolle']))).toEqual([]);
    expect(
      found(variant({ vitalitaet: '$all', befund: ['kontrolle'], foto: ['bauhof', 'kontrolle'] })),
    ).toEqual([]);
  });
  it('a task without `who` has no audience: the system runs it, nothing to disagree with', () => {
    const f = structuredClone(variant({ vitalitaet: ['bauhof'], befund: ['bauhof'], foto: ['bauhof'] }));
    Reflect.deleteProperty(f.tasks?.kontrolle ?? {}, 'who');
    expect(found(f)).toEqual([]);
  });
  it('a field writable by only some roles of the audience raises task_role_cannot_write, not task_field_not_writable', () => {
    const f = variant({ vitalitaet: '$all', befund: ['bauhof'], foto: '$all' }, ['kontrolle', 'bauhof']);
    expect(found(f)).toEqual([]);
    const w = foundRole(f);
    expect(w.map((p) => p.path)).toEqual(['tasks.kontrolle.form.befund']);
    expect(w[0]?.message).toMatch(/kontrolle/);
    expect(w[0]?.message).not.toMatch(/bauhof/);
    expect(w[0]?.hint?.length).toBeGreaterThan(0);
  });
  it('the reserved `admin` is no role of the audience', () => {
    const w = variant({ vitalitaet: ['bauhof'], befund: ['bauhof'], foto: ['bauhof'] }, ['bauhof', 'admin']);
    expect(found(w)).toEqual([]);
    expect(foundRole(w)).toEqual([]);
  });
});

// Property: the problem is raised exactly when the plan's own permission check (`compilePerms`) refuses a
// single-role actor of the audience for some field of the form while another role of it may write.
describe('compile: task_role_cannot_write (property)', () => {
  const roles = ['kontrolle', 'bauhof', 'verwaltung'];
  const fields = ['vitalitaet', 'befund']; // `foto` has a `relevant` condition: not analysed, so never mixed
  const audience = fc.subarray(roles);
  it('agrees with compilePerms.canWrite for random audiences and allowlists', () => {
    fc.assert(
      fc.property(
        fc.subarray(roles, { minLength: 1 }),
        fc.record({ vitalitaet: audience, befund: audience, foto: audience }),
        (admitted, write) => {
          const f = structuredClone(variant(write, admitted)) as TemplateFile;
          (f as { roles: Record<string, unknown> }).roles = {
            ...f.roles,
            verwaltung: { label: { de: 'Verwaltung' } },
          };
          const r = compile(f, { assets: goldenAssets });
          if (!r.ok) return false;
          const tp = compilePerms(r.config).forType('baum' as Key);
          let mixed = false;
          for (const field of fields) {
            const may = admitted.map((role) => tp?.canWrite([roleSubject(role)], [field]).ok === true);
            if (may.some((x) => x) && may.some((x) => !x)) mixed = true;
          }
          const hit = r.warnings.some((p) => p.code === 'task_role_cannot_write');
          return hit === mixed;
        },
      ),
      { numRuns: 200 },
    );
  });
});
