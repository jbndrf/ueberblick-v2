// WP-312: `properties.<p>.computed`. Every compile problem has its spec; a fitting file compiles and keeps the expressions.
import { describe, expect, it } from 'vitest';
import { compile } from './index';
import { TemplateFileSchema } from '../file';
import { goldenAssets } from '../../testing/golden';
import { computedFile } from './__fixtures__/computed';

type F = ReturnType<typeof computedFile>;
const run = (mutate: (f: F) => void) => {
  const f = computedFile();
  mutate(f);
  return compile(TemplateFileSchema.parse(f), { assets: goldenAssets });
};
const problems = (mutate: (f: F) => void) => {
  const r = run(mutate);
  return r.ok ? [] : r.problems;
};
const codes = (mutate: (f: F) => void) => problems(mutate).map((p) => p.code);
const parcel = (f: F) => f.types['parcel'] as F['types'][string];
const prop = (f: F, key: string) => parcel(f).properties[key] as F['types'][string]['properties'][string];

describe('compile: computed', () => {
  it('compiles a computed property and keeps its checked expression by path', () => {
    const r = run(() => undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.expressions.has('types.parcel.properties.area.computed')).toBe(true);
  });

  it('an expression that does not fit the property type is a problem at the computed path', () => {
    const p = problems((f) => {
      prop(f, 'area').computed = 'self.label';
    });
    expect(p.map((x) => x.code)).toContain('expression_type');
    expect(p[0]?.path).toBe('types.parcel.properties.area.computed');
  });

  it('a read of a property that does not exist is a dangling reference', () => {
    const p = problems((f) => {
      prop(f, 'area').computed = 'self.width * self.nope';
    });
    expect(p.map((x) => x.code)).toEqual(['dangling_reference']);
  });

  it('a cycle between computed properties is a problem, a self reference too', () => {
    expect(
      codes((f) => {
        parcel(f).properties['width'] = { type: 'integer', computed: 'self.height' };
        parcel(f).properties['height'] = { type: 'integer', computed: 'self.width' };
      }),
    ).toContain('computed_cycle');
    expect(
      codes((f) => {
        prop(f, 'area').computed = 'self.area + 1';
      }),
    ).toContain('computed_cycle');
  });

  it('a form listing a computed property compiles (display only); a quick edit or a then.set writing one is a problem', () => {
    const task = (f: F) => f.tasks['edit'] as F['tasks'][string];
    expect(
      codes((f) => {
        task(f).form['area'] = {};
      }),
    ).not.toContain('computed_written');
    expect(
      codes((f) => {
        task(f).steps = [{ kind: 'form' }, { kind: 'quick_edit', properties: ['area'] }];
      }),
    ).toContain('computed_written');
    expect(
      codes((f) => {
        task(f).then = [{ set: { area: '1' } }];
      }),
    ).toContain('computed_written');
  });

  it('a then.set through a bound feature that writes a computed property is a problem', () => {
    const p = problems((f) => {
      (f.types['owner'] as F['types'][string]).properties['width'] = { type: 'integer', computed: '1' };
      const task = f.tasks['edit'] as F['tasks'][string] & { bind?: Record<string, string> };
      task.bind = { o: 'self.owner' };
      task.then = [{ set: { 'o.width': '5' } }];
    });
    const hit = p.find((x) => x.code === 'computed_written');
    expect(hit?.path).toBe('tasks.edit.then["0"].set["o.width"]');
  });

  it('a computed select gives no dead_option warning', () => {
    const r = run(() => undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).not.toContain('dead_option');
  });

  it('computed together with default is a problem', () => {
    expect(
      codes((f) => {
        prop(f, 'area').default = 0;
      }),
    ).toContain('computed_default');
  });

  it('a read through a relation or a reference, actor, now and today() are unsupported inputs', () => {
    for (const expr of [
      'self.owner.width',
      'size(self.neighbours)',
      "actor.id == 'x' ? 1 : 0",
      'now > self.stamp ? 1 : 0',
      'today() > self.stamp ? 1 : 0',
      'self.$changed_at > self.stamp ? 1 : 0',
    ])
      expect(
        codes((f) => {
          prop(f, 'area').computed = expr;
        }),
        expr,
      ).toContain('computed_input_unsupported');
  });

  it('the system fields created_by and lifecycle are supported inputs', () => {
    const r = run((f) => {
      parcel(f).properties['note'] = { type: 'text', computed: 'self.$lifecycle + self.$created_by' };
    });
    expect(r.ok).toBe(true);
  });
});
