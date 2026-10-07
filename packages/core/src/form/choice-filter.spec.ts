// WP-392 (E-25, ODK choice_filter): the options a select offers depend on earlier answers.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Json, Key } from '../model';
import { compile } from '../schema/compile';
import { TemplateFileSchema } from '../schema/file';
import { goldenAssets } from '../testing/golden';
import { formApi } from './index';
import { FILE, ctx, world } from './__fixtures__';

type Loose = Record<string, unknown>;

function withFilter(extra: Loose = {}, props: Loose = {}, tasks: Loose = {}): Loose {
  return {
    ...FILE,
    types: {
      ...FILE.types,
      baum: {
        ...FILE.types.baum,
        properties: {
          ...FILE.types.baum.properties,
          art: {
            type: 'select',
            options: { eiche: 'Eiche', linde: 'Linde', kiefer: 'Kiefer' },
            option_hints: { linde: { de: 'Tilia', en: 'Lime' } },
          },
          gruppe: { type: 'select', options: { laub: 'Laub', nadel: 'Nadel' } },
          ...props,
        },
      },
    },
    tasks: {
      ...FILE.tasks,
      wahl: {
        label: { de: 'Wahl' },
        on: 'baum',
        form: {
          gruppe: {},
          art: { choice_filter: "form.gruppe == 'laub' ? option != 'kiefer' : option == 'kiefer'", ...extra },
        },
      },
      ...tasks,
    },
  };
}

const config = world(withFilter());
const W = 'wahl' as Key;
const ev = (values: Record<string, Json>) => formApi.evaluate(W, config, values, ctx(config));
const art = (values: Record<string, Json>) => {
  const f = ev(values).fields.find((x) => x.key === 'art');
  if (!f) throw new Error('art');
  return f;
};
const keys = (values: Record<string, Json>) => art(values).options?.map((o) => o.key);

describe('choice_filter: core.form', () => {
  it('offers the options for which the filter is true, in property order', () => {
    expect(keys({ gruppe: 'laub' })).toEqual(['eiche', 'linde']);
    expect(keys({ gruppe: 'nadel' })).toEqual(['kiefer']);
  });

  it('carries the explanation text of an offered option', () => {
    expect(art({ gruppe: 'laub' }).options).toEqual([
      { key: 'eiche' },
      { key: 'linde', hint: { de: 'Tilia', en: 'Lime' } },
    ]);
  });

  it('a field without choice_filter has no `options` (every option is offered)', () => {
    expect(ev({}).fields.find((f) => f.key === 'gruppe')?.options).toBeUndefined();
  });

  it('an answer the filter removes has the option issue and is left out of the submit (cleared)', () => {
    const e = ev({ gruppe: 'nadel', art: 'eiche' });
    expect(art({ gruppe: 'nadel', art: 'eiche' }).issues).toEqual([{ issue: 'option' }]);
    expect(e.valid).toBe(false);
    expect(formApi.submitValues(e)).toEqual({ gruppe: 'nadel' });
    expect(art({ gruppe: 'laub', art: 'eiche' }).issues).toEqual([]);
  });

  it('waitingForSource is true while a field the filter reads is empty, and only on a filtered field (WP-734, v3 smart_dropdown)', () => {
    expect(art({}).waitingForSource).toBe(true);
    expect(art({ gruppe: '' }).waitingForSource).toBe(true);
    expect(art({ gruppe: 'laub' }).waitingForSource).toBe(false);
    expect(ev({}).fields.find((f) => f.key === 'gruppe')?.waitingForSource).toBeUndefined();
  });

  it('dependents: a change of the source re-evaluates the filtered field', () => {
    expect(formApi.dependents(W, config, 'gruppe' as Key)).toEqual(['gruppe', 'art']);
  });

  it('a multiselect is checked per element', () => {
    const c = world(
      withFilter(
        {},
        { arten: { type: 'multiselect', options: { eiche: 'Eiche', kiefer: 'Kiefer' } } },
        {
          multi: { label: { de: 'M' }, on: 'baum', form: { arten: { choice_filter: "option == 'eiche'" } } },
        },
      ),
    );
    const run = (v: Json) =>
      formApi.evaluate('multi' as Key, c, { arten: v }, ctx(c)).fields[0]?.issues.map((i) => i.issue);
    expect(run(['eiche'])).toEqual([]);
    expect(run(['eiche', 'kiefer'])).toEqual(['option']);
  });

  it('property: the offered set is exactly the options the filter accepts', () => {
    fc.assert(
      fc.property(fc.constantFrom('laub', 'nadel'), (g) => {
        const expected = ['eiche', 'linde', 'kiefer'].filter((k) =>
          g === 'laub' ? k !== 'kiefer' : k === 'kiefer',
        );
        expect(keys({ gruppe: g })).toEqual(expected);
      }),
    );
  });
});

describe('choice_filter: compile', () => {
  const problems = (file: unknown) => {
    const r = compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
    return (r.ok ? [] : r.problems).filter((x) => x.code !== 'task_field_not_writable');
  };

  it('a filter that is not a bool is expression_type', () => {
    const p = problems(withFilter({ choice_filter: 'option' }));
    expect(p.filter((x) => x.code === 'expression_type').map((x) => [x.code, x.path])).toEqual([
      ['expression_type', 'tasks.wahl.form.art.choice_filter'],
    ]);
  });

  it('a filter on a non-select is choice_filter_invalid', () => {
    const p = problems(
      withFilter({}, {}, { wahl: { label: 'W', on: 'baum', form: { befund: { choice_filter: 'true' } } } }),
    );
    expect(p.filter((x) => x.code === 'choice_filter_invalid').map((x) => [x.code, x.path])).toEqual([
      ['choice_filter_invalid', 'tasks.wahl.form.befund.choice_filter'],
    ]);
  });

  it('an unknown name in the filter is a problem', () => {
    expect(problems(withFilter({ choice_filter: 'nix == option' })).length).toBeGreaterThan(0);
  });

  it('option_hints must name options and only select types take them', () => {
    const bad = { gruppe: { type: 'select', options: { a: 'A' }, option_hints: { b: 'B' } } };
    expect(() => TemplateFileSchema.parse(withFilter({}, bad))).toThrow(/not an option/);
    expect(() =>
      TemplateFileSchema.parse(withFilter({}, { notiz: { type: 'text', option_hints: { b: 'B' } } })),
    ).toThrow();
  });
});
