/** The builder rows for boolean, time, participant ("ich"), reference and localized text (WP-809). */
import { describe, expect, it } from 'vitest';
import { applyFilter } from './evaluate';
import { builderContext } from './builder-context';
import { clausesToFilter, type Clause } from './clauses';
import { filterToClauses } from './clauses-decode';
import { compileFilter } from './index';
import { actorOf, envOver, featureOf } from './__fixtures__/views-world';
import { rowsWorld } from './__fixtures__/rows-world';

const config = rowsWorld();
const me = actorOf(['kontrolle'], 'u1');
const ctx = builderContext(config, me, 'de');
const encode = (cs: readonly Clause[]) => clausesToFilter(cs, ctx.types, () => undefined);
const row = (key: string, propType: string, rest: object): Clause =>
  ({ kind: 'field', type: 'baum', key, propType, ...rest }) as Clause;

const bool = (value: boolean | null) => row('ok', 'boolean', { editor: 'boolean', value });
const time = (from: string | null, to: string | null) => row('uhrzeit', 'time', { editor: 'time', from, to });
const who = (mine: boolean) => row('zustaendig', 'participant', { editor: 'participant', me: mine });
const presence = (key: string, propType: string, state: 'empty' | 'filled' | null) =>
  row(key, propType, { editor: 'presence', state });

describe('the offered fields', () => {
  it('offers every new type with its editor', () => {
    const editors = Object.fromEntries(
      ctx.fields.filter((f) => f.type === 'baum').map((f) => [f.key, f.editor]),
    );
    expect(editors).toMatchObject({
      ok: 'boolean',
      uhrzeit: 'time',
      zustaendig: 'participant',
      bank: 'presence',
      titel: 'presence',
    });
  });
});

describe('each row writes rule-language source and reads back to the same row', () => {
  const cases: [string, Clause, string][] = [
    ['boolean yes', bool(true), '(self.ok == true)'],
    ['boolean no', bool(false), '(self.ok == false)'],
    ['time from', time('08:00', null), '(self.uhrzeit >= "08:00")'],
    ['time to', time(null, '17:30'), '(self.uhrzeit <= "17:30")'],
    ['time between', time('08:00', '17:30'), '(self.uhrzeit >= "08:00" && self.uhrzeit <= "17:30")'],
    ['ich', who(true), '(self.zustaendig == actor.id)'],
    ['reference empty', presence('bank', 'reference', 'empty'), '(self.bank == null)'],
    ['reference filled', presence('bank', 'reference', 'filled'), '(self.bank != null)'],
    ['localized empty', presence('titel', 'localized_text', 'empty'), '(self.titel == null)'],
    ['localized filled', presence('titel', 'localized_text', 'filled'), '(self.titel != null)'],
  ];
  for (const [name, clause, source] of cases)
    it(name, () => {
      const view = encode([clause]);
      expect(view).toEqual({ baum: source });
      expect(compileFilter(config, view).ok).toBe(true);
      expect(filterToClauses(config, view, ctx.types)).toEqual([clause]);
    });

  it('an open row writes nothing', () => {
    expect(encode([bool(null), time(null, null), who(false), presence('bank', 'reference', null)])).toEqual(
      {},
    );
  });
  it('a time bound that is no HH:MM writes nothing', () => {
    expect(encode([time('8am', 'x')])).toEqual({});
  });
});

describe('evaluation', () => {
  const all = [
    featureOf('own', 'baum', { zustaendig: 'u1', ok: true, uhrzeit: '09:00', bank: 'b1' }),
    featureOf('other', 'baum', { zustaendig: 'u2', ok: false, uhrzeit: '18:00' }),
    featureOf('none', 'baum', {}),
  ];
  const ids = (cs: readonly Clause[]) => {
    const r = compileFilter(config, encode(cs));
    if (!r.ok) throw new Error('compile');
    return applyFilter(envOver(config, me, all), r.filter, 'baum', all).map((f) => f.id);
  };
  it('"ich" is true for own features only', () => expect(ids([who(true)])).toEqual(['own']));
  it('boolean', () => {
    expect(ids([bool(true)])).toEqual(['own']);
    expect(ids([bool(false)])).toEqual(['other']);
  });
  it('time', () => expect(ids([time('08:00', '12:00')])).toEqual(['own']));
  it('reference presence', () => {
    expect(ids([presence('bank', 'reference', 'filled')])).toEqual(['own']);
    expect(ids([presence('bank', 'reference', 'empty')])).toEqual(['other', 'none']);
  });
});

describe('terms the rows do not cover stay rules', () => {
  it('a hand-written boolean test on a text property is kept', () => {
    const rows = filterToClauses(config, { baum: 'self.name == true' }, ctx.types);
    expect(rows.map((r) => r.kind)).toEqual(['rule']);
  });
});
