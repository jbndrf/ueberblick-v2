import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Json, Key } from '../model';
import { FormConfigError, formApi } from './index';
import type { FormValues } from './contract';
import { FILE, ctx, world } from './__fixtures__';

const config = world();
const K = 'kontrolle' as Key;
const self = { vitalitaet: 'v2', befund: 'alt' };
const c = () => ctx(config, self);
const ev = (values: FormValues) => formApi.evaluate(K, config, values, c());
const field = (e: ReturnType<typeof ev>, key: string) => {
  const f = e.fields.find((x) => x.key === key);
  if (!f) throw new Error(key);
  return f;
};
const kinds = (e: ReturnType<typeof ev>, key: string) => field(e, key).issues.map((i) => i.issue);

describe('0015 semantics', () => {
  it('lists fields in form order', () => {
    expect(ev({}).fields.map((f) => f.key)).toEqual(Object.keys(FILE.tasks.kontrolle.form));
  });

  it('required only counts while relevant; non-relevant fields have no issues and are dropped', () => {
    const e = ev({ vitalitaet: 'v2', befund: 'neu', hoehe_m: 30 });
    expect(field(e, 'grund').relevant).toBe(true);
    expect(kinds(e, 'grund')).toEqual(['required']);
    const e2 = ev({ vitalitaet: 'v2', befund: 'neu', hoehe_m: 5, grund: 'x', foto: 'p' });
    expect(field(e2, 'grund').relevant).toBe(false);
    expect(field(e2, 'foto').relevant).toBe(false);
    expect(e2.fields.flatMap((f) => (f.relevant ? [] : f.issues))).toEqual([]);
    const sub = formApi.submitValues(e2);
    expect(sub).not.toHaveProperty('grund');
    expect(sub).not.toHaveProperty('foto');
    expect(sub).toMatchObject({ befund: 'neu', hoehe_m: 5 });
  });

  it('a relevant flip keeps the value (photo kept at v3)', () => {
    const at3 = ev({ vitalitaet: 'v3', befund: 'neu', foto: 'p' });
    expect(formApi.submitValues(at3)).toHaveProperty('foto', 'p');
  });

  it('required is a literal or an expression', () => {
    expect(field(ev({}), 'befund').required).toBe(true);
    expect(field(ev({ hoehe_m: 30 }), 'notiz').required).toBe(true);
    expect(field(ev({ hoehe_m: 5 }), 'notiz').required).toBe(false);
    expect(kinds(ev({ vitalitaet: 'v2' }), 'befund')).toEqual(['required']);
  });

  it('empty values (null, empty string, empty list) count as missing', () => {
    for (const empty of [null, '', []] as Json[])
      expect(kinds(ev({ vitalitaet: 'v2', befund: empty }), 'befund')).toEqual(['required']);
  });

  it('constraint failures carry constraint_message; the constraint reads `value`', () => {
    const e = ev({ vitalitaet: 'v2', befund: 'alt' });
    expect(field(e, 'befund').issues).toEqual([
      { issue: 'constraint', message: FILE.tasks.kontrolle.form.befund.constraint_message },
    ]);
    expect(e.valid).toBe(false);
    expect(kinds(ev({ vitalitaet: 'v2', befund: 'neu', hoehe_m: 80 }), 'hoehe_m')).toEqual(['constraint']);
    expect(ev({ vitalitaet: 'v2', befund: 'neu', hoehe_m: 12 }).valid).toBe(true);
  });

  it('an empty optional field skips its constraint', () => {
    expect(kinds(ev({ vitalitaet: 'v2', befund: 'neu' }), 'hoehe_m')).toEqual([]);
  });

  it('expression errors count as false and are reported', () => {
    const e = formApi.evaluate('kaputt' as Key, config, { befund: 'abcd' }, c());
    const f = e.fields[0];
    expect(f?.relevant).toBe(false);
    expect(f?.errors.map((x) => x.attr)).toEqual(['relevant']);
    const cfg = world({
      ...FILE,
      tasks: { t: { label: { de: 'T' }, on: 'baum', form: { befund: { constraint: '1 / 0 == 1' } } } },
    });
    const e2 = formApi.evaluate('t' as Key, cfg, { befund: 'x' }, ctx(cfg));
    const issue = e2.fields[0]?.issues[0];
    expect(issue?.issue).toBe('constraint');
    expect(issue?.error?.message).toBeTruthy();
    expect(e2.valid).toBe(false);
  });

  it('a supplied value for a readonly calculated field must equal the computed one', () => {
    const bad = ev({ vitalitaet: 'v2', befund: 'neu', hoehe_m: 30, hoehe_klasse: 'klein' });
    expect(kinds(bad, 'hoehe_klasse')).toEqual(['readonly']);
    const ok = ev({ vitalitaet: 'v2', befund: 'neu', hoehe_m: 30, hoehe_klasse: 'gross' });
    expect(kinds(ok, 'hoehe_klasse')).toEqual([]);
  });

  it('a task without a form evaluates to an empty valid form; an unknown task throws', () => {
    expect(formApi.evaluate('leer' as Key, config, {}, c())).toMatchObject({ fields: [], valid: true });
    expect(() => formApi.evaluate('nope' as Key, config, {}, c())).toThrow(FormConfigError);
  });

  it('fails closed when a declared expression was not compiled', () => {
    const broken = {
      ...config,
      expressions: new Map([...config.expressions].filter(([p]) => !p.includes('constraint'))),
    };
    expect(() => formApi.evaluate(K, broken, {}, c())).toThrow(FormConfigError);
    expect(() => formApi.dependents(K, broken, 'befund' as Key)).toThrow(FormConfigError);
  });
});

describe('initial', () => {
  it('calculate prefills from the current state, presets override', () => {
    expect(formApi.initial(K, config, c())).toMatchObject({ vitalitaet: 'v2', hoehe_klasse: '', zaehler: 1 });
    expect(formApi.initial(K, config, c(), { vitalitaet: 'v4' })).toMatchObject({ vitalitaet: 'v4' });
  });

  it('a calculate that reads a preset sees it', () => {
    expect(formApi.initial(K, config, c(), { hoehe_m: 30 })).toMatchObject({ hoehe_klasse: 'gross' });
  });

  it('editing is never overwritten: evaluate keeps an edited calculated field (the v3 prefill bug)', () => {
    const start = formApi.initial(K, config, c());
    const edited = { ...start, vitalitaet: 'v9', zaehler: 7 };
    const e = ev(edited);
    expect(field(e, 'vitalitaet').value).toBe('v9');
    expect(field(e, 'zaehler').value).toBe(7);
    expect(formApi.submitValues(e)).toMatchObject({ vitalitaet: 'v9', zaehler: 7 });
  });
});

describe('readonly calculated fields', () => {
  it('are recomputed in evaluate and submitValues, following their inputs', () => {
    const a = ev({ vitalitaet: 'v2', befund: 'n', hoehe_m: 5, hoehe_klasse: 'klein' });
    expect(field(a, 'hoehe_klasse').value).toBe('klein');
    const b = ev({ vitalitaet: 'v2', befund: 'n', hoehe_m: 30 });
    expect(field(b, 'hoehe_klasse').value).toBe('gross');
    expect(formApi.submitValues(b)).toMatchObject({ hoehe_klasse: 'gross' });
  });
});

describe('dependents', () => {
  const dep = (f: string) => formApi.dependents(K, config, f as Key);
  it('lists readers in form order, the field itself, and follows readonly calculated chains', () => {
    expect(dep('vitalitaet')).toEqual(['vitalitaet', 'foto']);
    expect(dep('hoehe_m')).toEqual(['hoehe_m', 'hoehe_klasse', 'notiz', 'grund']);
    expect(dep('befund')).toEqual(['befund']);
  });

  it('an expression reading the whole `form` depends on every field', () => {
    const cfg = world({
      ...FILE,
      tasks: {
        t: { label: { de: 'T' }, on: 'baum', form: { befund: {}, notiz: { relevant: 'form == form' } } },
      },
    });
    expect(formApi.dependents('t' as Key, cfg, 'befund' as Key)).toEqual(['befund', 'notiz']);
  });

  const scalar = fc.oneof(
    fc.constant(undefined),
    fc.constantFrom('v1', 'v2', 'v3', 'alt', 'neu', ''),
    fc.integer({ min: -5, max: 90 }),
  );
  const values = fc.record(
    {
      vitalitaet: scalar,
      befund: scalar,
      foto: scalar,
      hoehe_m: scalar,
      notiz: scalar,
      grund: scalar,
      zaehler: scalar,
    },
    { requiredKeys: [] },
  );
  const clean = (v: Record<string, Json | undefined>): FormValues =>
    Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as FormValues;

  it('property: after changing one field, every field outside dependents() keeps its state', () => {
    const fields = Object.keys(FILE.tasks.kontrolle.form);
    fc.assert(
      fc.property(values, fc.constantFrom(...fields), scalar, (v, changed, next) => {
        const after: Record<string, Json | undefined> = { ...v, [changed]: next };
        const inside = new Set(dep(changed));
        const a = ev(clean({ ...v }));
        const b = ev(clean(after));
        for (const f of fields) if (!inside.has(f as Key)) expect(field(b, f)).toEqual(field(a, f));
      }),
      { numRuns: 300 },
    );
  });
});
