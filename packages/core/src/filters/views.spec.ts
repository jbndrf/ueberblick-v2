/** The view builder's core (WP-665): rows to rule-language source, source back to rows, and the evaluation by core. */
import { describe, expect, it } from 'vitest';
import { builderContext, creatorIds } from './builder-context';
import { nextDay, previousDay, type Clause } from './clauses';
import { filterToClauses } from './clauses-decode';
import { compileFilter } from './index';
import { actorOf, featureOf } from './__fixtures__/views-world';
import {
  by,
  choice,
  config,
  ctx,
  day,
  dayTime,
  encode,
  kontrolle,
  num,
  stage,
  text,
  when,
} from './__fixtures__/views-rows';

describe('builderContext (v3 +page.svelte:1405-1461)', () => {
  it('offers readable properties that have an editor, by their editor, with the Objektart as description', () => {
    const got = ctx.fields.filter((f) => f.type === 'baum').map((f) => [f.key, f.editor]);
    expect(got).toEqual([
      ['art', 'choice'],
      ['hoehe', 'number'],
      ['ok', 'boolean'],
      ['intern', 'text'],
      ['kontrolliert', 'date'],
      ['tags', 'choice'],
      ['name', 'text'],
      ['pflanzdatum', 'date'],
      ['stamm', 'number'],
    ]);
    expect(ctx.fields.find((f) => f.key === 'art')?.options).toEqual([
      { value: 'eiche', label: 'Eiche' },
      { value: 'linde', label: 'Linde' },
    ]);
    expect(ctx.fields.find((f) => f.key === 'name')?.typeLabel).toBe('Baum');
  });
  it('leaves out files, geometries, the stage (it has its own row) and types without a place on the map', () => {
    const keys = ctx.fields.map((f) => f.key);
    for (const k of ['foto', 'standort', 'stufe']) expect(keys).not.toContain(k);
    expect(ctx.types).toEqual(['baum', 'bank']);
    expect(ctx.fields.some((f) => f.type === 'notiz')).toBe(false);
  });
  it('offers only what the role may read', () => {
    const bauhof = builderContext(config, actorOf(['bauhof']), 'de');
    expect(bauhof.fields.map((f) => f.key)).not.toContain('intern');
    expect(ctx.fields.map((f) => f.key)).toContain('intern');
  });
  it('lists the stages of a process in declaration order, with labels', () => {
    expect(ctx.stages).toEqual([
      {
        type: 'baum',
        typeLabel: 'Baum',
        property: 'stufe',
        stages: [
          { value: 'neu', label: 'Neu' },
          { value: 'geprueft', label: 'Geprüft' },
          { value: 'fertig', label: 'Fertig' },
        ],
      },
    ]);
  });
  it('localises (English label of the Objektart)', () => {
    expect(builderContext(config, kontrolle, 'en').fields.find((f) => f.key === 'name')?.typeLabel).toBe(
      'Tree',
    );
  });
  it('creatorIds: the distinct creators, once each', () => {
    const fs = ['a', 'b', 'a', undefined].map((c, i) =>
      featureOf(`f${i}`, 'baum', {}, c ? { createdBy: c } : {}),
    );
    expect(creatorIds(fs)).toEqual(['a', 'b']);
  });
});

describe('every row kind is rule-language source (R5)', () => {
  it('writes each kind as v3 meant it', () => {
    expect(encode([text('eiche')])).toEqual({ baum: '(self.name.contains("eiche"))' });
    expect(encode([num(1, 5)])).toEqual({ baum: '(self.hoehe >= 1 && self.hoehe <= 5)' });
    expect(encode([num(null, 5)])).toEqual({ baum: '(self.hoehe <= 5)' });
    expect(encode([day('2026-01-01', '2026-01-31')])).toEqual({
      baum: '(self.pflanzdatum >= date("2026-01-01") && self.pflanzdatum <= date("2026-01-31"))',
    });
    expect(encode([choice('art', 'select', ['eiche', 'linde'])])).toEqual({
      baum: '(self.art in ["eiche","linde"])',
    });
    expect(encode([choice('tags', 'multiselect', ['a'])])).toEqual({
      baum: '(["a"].exists(o, o in self.tags))',
    });
    expect(encode([stage(['neu', 'fertig'])])).toEqual({ baum: '(self.stufe in ["neu","fertig"])' });
    expect(encode([when('created', 'older', 7)])).toEqual({
      baum: '(self.$created_at < now - days(7))',
      bank: '(self.$created_at < now - days(7))',
    });
    expect(encode([when('changed', 'newer', 3)]).bank).toBe('(self.$changed_at > now - days(3))');
    expect(encode([by(['u1', 'u2'])]).baum).toBe('(self.$created_by in ["u1","u2"])');
  });
  it('a timestamp range includes the whole last day (better than v3)', () => {
    expect(encode([when('created', 'between', 7, '2026-10-01', '2026-10-05')]).baum).toBe(
      '(self.$created_at >= date("2026-10-01") && self.$created_at < date("2026-10-06"))',
    );
    expect(encode([dayTime(null, '2026-10-05')]).baum).toBe('(self.kontrolliert < date("2026-10-06"))');
  });
  it('an empty row writes nothing, and no row means no entry (v3: a half-built view still shows data)', () => {
    expect(
      encode([text('  '), num(null, null), day(null, null), choice('art', 'select', []), stage([])]),
    ).toEqual({});
    expect(encode([when('created', 'between'), when('created', 'older', 0), by([])])).toEqual({});
  });
  it('joins the rows of an Objektart with AND, field rows only on their Objektart, the others on all', () => {
    const f = encode([text('x'), by(['u1']), num(2, null)]);
    expect(f.baum).toBe('(self.name.contains("x")) && (self.$created_by in ["u1"]) && (self.hoehe >= 2)');
    expect(f.bank).toBe('(self.$created_by in ["u1"])');
    expect(f.notiz).toBeUndefined();
  });
  it('puts the timestamp terms last, so the evaluator reaches them only for features that passed the cheap ones', () => {
    const f = encode([when('created', 'older', 7), day('2026-01-01', null), text('x'), num(1, null)]);
    expect(f.baum).toBe(
      '(self.name.contains("x")) && (self.hoehe >= 1) && (self.$created_at < now - days(7)) && (self.pflanzdatum >= date("2026-01-01"))',
    );
  });
  it('every kind compiles against the config', () => {
    const f = encode([
      text('a'),
      num(1, 2),
      day('2026-01-01', null),
      dayTime('2026-01-01', '2026-02-01'),
      choice('art', 'select', ['eiche']),
      choice('tags', 'multiselect', ['a']),
      stage(['neu']),
      when('created', 'older', 5),
      when('changed', 'between', 1, '2026-01-01', '2026-02-01'),
      by(['u1']),
    ]);
    const r = compileFilter(config, f);
    expect(r.ok, JSON.stringify(r.ok ? [] : r.problems)).toBe(true);
  });
});

describe('reading a saved view back', () => {
  it('round-trips what the builder wrote', () => {
    const rows = [
      text('eiche'),
      num(1, 5),
      day('2026-01-01', '2026-01-31'),
      dayTime('2026-01-01', '2026-01-31'),
      choice('art', 'select', ['eiche']),
      choice('tags', 'multiselect', ['a', 'b']),
      stage(['neu']),
      when('created', 'older', 7),
      when('changed', 'between', 7, '2026-01-01', null),
      by(['u1']),
    ];
    const back = filterToClauses(config, encode(rows), ctx.types);
    const key = (c: Clause) => JSON.stringify(c);
    expect(back.map(key).sort()).toEqual(rows.map(key).sort());
  });
  it('keeps a term the builder has no row for, and writes it back unchanged', () => {
    const view = { baum: "self.hoehe > 3 && self.name.startsWith('x') && self.stufe == 'neu'" };
    const rows = filterToClauses(config, view, ctx.types);
    // `>` has no row (v3 ranges are inclusive), so it is kept as a rule as well
    expect(rows.filter((r) => r.kind === 'rule').map((r) => (r.kind === 'rule' ? r.source : ''))).toEqual([
      'self.hoehe > 3',
      "self.name.startsWith('x')",
      "self.stufe == 'neu'",
    ]);
    const again = encode(rows);
    const r = compileFilter(config, again);
    expect(r.ok).toBe(true);
    expect(again.baum).toContain("self.name.startsWith('x')");
    expect(again.baum).toContain("self.stufe == 'neu'");
  });
  it('a creator row on only one Objektart stays a rule of that Objektart (it is not "every Objektart")', () => {
    const rows = filterToClauses(config, { baum: 'self.$created_by in ["u1"]' }, ctx.types);
    expect(rows).toEqual([{ kind: 'rule', type: 'baum', source: "self.$created_by in ['u1']" }]);
  });
  it('a view that does not parse is one rule row; the empty view has no rows', () => {
    expect(filterToClauses(config, { baum: 'self.hoehe >' }, ctx.types)).toEqual([
      { kind: 'rule', type: 'baum', source: 'self.hoehe >' },
    ]);
    expect(filterToClauses(config, {}, ctx.types)).toEqual([]);
  });
  it('days: next and previous are calendar steps', () => {
    expect(nextDay('2026-02-28')).toBe('2026-03-01');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
  });
});
