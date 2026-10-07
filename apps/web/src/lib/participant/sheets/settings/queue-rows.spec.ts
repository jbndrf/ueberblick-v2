import { describe, expect, it } from 'vitest';
import type { RunId } from '@ueberblick/core/model';
import { storedRun } from './fake-device.testing';
import { openCount, queueRows, refusedRows } from './queue-rows';

const label = (k: string): string => `Aufgabe ${k}`;
const refusal = { code: 'forbidden', message: 'Not allowed' };

describe('queueRows', () => {
  const runs = [
    storedRun('c', 3, 'review', { featureId: 'f3' }),
    storedRun('a', 1, 'queued', { featureId: 'f1' }),
    storedRun('b', 2, 'refused', { featureId: 'f2', refusal }),
    storedRun('d', 4, 'accepted', { featureId: 'f4' }),
    storedRun('e', 5, 'queued'),
  ];

  it('lists runs in queue order and leaves out those the server accepted', () => {
    const rows = queueRows(runs, { sending: undefined }, label, 'de');
    expect(rows.map((r) => r.runId)).toEqual(['a', 'b', 'c', 'e']);
    expect(rows[0]?.task).toBe('Aufgabe inspect');
  });

  it('says the state in words, in the person language', () => {
    const de = queueRows(runs, { sending: undefined }, label, 'de');
    expect(de.map((r) => r.stateText)).toEqual([
      'Wartet auf Übertragung',
      'Abgelehnt',
      'Wartet auf Prüfung',
      'Wartet auf Übertragung',
    ]);
    const en = queueRows(runs, { sending: undefined }, label, 'en');
    expect(en[1]?.stateText).toBe('Refused');
  });

  it('a refused run carries the engine reason and can be sent again; a waiting run can only be discarded', () => {
    const [waiting, refused, review] = queueRows(runs, { sending: undefined }, label, 'en');
    expect(refused?.reason).toBe('The change was not applied.'); // a code this build does not know: the general sentence
    expect([refused?.canResend, refused?.canDiscard]).toEqual([true, true]);
    expect([waiting?.canResend, waiting?.canDiscard]).toEqual([false, true]);
    expect([review?.canResend, review?.canDiscard]).toEqual([false, true]);
  });

  it('a refusal is a plain sentence plus the field label, never the code (de and en)', () => {
    const r = { code: 'required_missing', message: 'dev', path: 'form.befund' };
    const one = [storedRun('x', 1, 'refused', { featureId: 'f1', task: 'kontrolle', refusal: r })];
    const fl = (task: string, f: string): string | undefined =>
      task === 'kontrolle' && f === 'befund' ? 'Befund' : undefined;
    expect(queueRows(one, { sending: undefined }, label, 'de', fl)[0]?.reason).toBe(
      'Ein Pflichtfeld fehlt. Feld: Befund',
    );
    expect(queueRows(one, { sending: undefined }, label, 'en', fl)[0]?.reason).toBe(
      'A required field is missing. Field: Befund',
    );
  });

  it('the run in flight is "sending"', () => {
    const rows = queueRows(runs, { sending: 'a' as RunId }, label, 'en');
    expect(rows[0]?.state).toBe('sending');
    expect(rows[0]?.canDiscard).toBe(false); // the button waits until the send settles
    expect(rows[0]?.stateText).toBe('Uploading');
  });

  it('every run of the batch in flight is sending and cannot be discarded', () => {
    const batch = [
      storedRun('g1', 1, 'queued', { group: 'G' }),
      storedRun('g2', 2, 'queued', { group: 'G' }),
      storedRun('h1', 3, 'queued', { group: 'H' }),
    ];
    const rows = queueRows(batch, { sending: 'g1' as RunId }, label, 'en');
    expect(rows.map((r) => [r.state, r.canDiscard])).toEqual([
      ['sending', false],
      ['sending', false],
      ['queued', true],
    ]);
  });

  it('each row names its Objekt, and a run that creates one has none', () => {
    const rows = queueRows(runs, { sending: undefined }, label, 'en');
    expect(rows.map((r) => r.featureId)).toEqual(['f1', 'f2', 'f3', undefined]);
  });

  it('refusedRows and openCount split the list, optionally for one Objekt', () => {
    const rows = queueRows(runs, { sending: undefined }, label, 'en');
    expect(refusedRows(rows).map((r) => r.runId)).toEqual(['b', 'c']);
    expect(refusedRows(rows, 'f2' as never).map((r) => r.runId)).toEqual(['b']);
    expect(openCount(rows)).toBe(2);
  });

  it('a dependent run says it rests on a refused change, then the culprit sentence, and can be resent (WP-767)', () => {
    const dep = [
      storedRun('d', 1, 'dependent', { featureId: 'f9', refusal: { code: 'not_permitted', message: 'x' } }),
    ];
    const [de] = queueRows(dep, { sending: undefined }, label, 'de');
    expect(de?.stateText).toBe('Folgeänderung abgelehnt');
    expect(de?.reason).toBe(
      'Beruht auf einer abgelehnten Änderung. Du darfst diese Änderung nicht vornehmen.',
    );
    expect([de?.dependent, de?.canResend, de?.canDiscard]).toEqual([true, true, true]);
    expect(refusedRows(queueRows(dep, { sending: undefined }, label, 'de'), 'f9' as never)).toHaveLength(1);
  });

  it('a row jumps only while its Objekt is on the device', () => {
    const dep = [
      storedRun('d', 1, 'dependent', { featureId: 'f9', refusal }),
      storedRun('e', 2, 'queued', { featureId: 'f1' }),
    ];
    const rows = queueRows(dep, { sending: undefined }, label, 'de', undefined, (id) => id === 'f1');
    expect(rows.map((r) => r.canJump)).toEqual([false, true]);
  });
});
