import { describe, expect, it } from 'vitest';
import { createDraftSaver, type PutOutcome, type SaveState } from './draft-saver';

/** A put whose answer the test releases by hand. */
function gate() {
  const calls: { overlay: string; revision: number; answer: (o: PutOutcome) => void }[] = [];
  const put = (overlay: string, revision: number) =>
    new Promise<PutOutcome>((resolve) => calls.push({ overlay, revision, answer: resolve }));
  return { calls, put };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createDraftSaver', () => {
  it('sends the overlay with the held revision and takes the new one from the answer', async () => {
    const g = gate();
    const states: SaveState[] = [];
    const s = createDraftSaver({ revision: 4, put: g.put, onstate: (x) => states.push(x) });
    s.save('a');
    expect(g.calls.map((c) => [c.overlay, c.revision])).toEqual([['a', 4]]);
    g.calls[0]?.answer({ kind: 'saved', revision: 5 });
    await flush();
    s.save('b');
    expect(g.calls[1]).toMatchObject({ overlay: 'b', revision: 5 });
    expect(states).toEqual(['saving', 'saved', 'saving']);
  });

  it('keeps one write in flight and sends only the latest overlay after it', async () => {
    const g = gate();
    const s = createDraftSaver({ revision: 1, put: g.put, onstate: () => undefined });
    s.save('a');
    s.save('b');
    s.save('c');
    expect(g.calls).toHaveLength(1);
    g.calls[0]?.answer({ kind: 'saved', revision: 2 });
    await flush();
    expect(g.calls.map((c) => [c.overlay, c.revision])).toEqual([
      ['a', 1],
      ['c', 2],
    ]);
  });

  it('a stale answer is a conflict: nothing more is sent and the reason is kept', async () => {
    const g = gate();
    const states: SaveState[] = [];
    const s = createDraftSaver({ revision: 1, put: g.put, onstate: (x) => states.push(x) });
    s.save('a');
    s.save('b');
    g.calls[0]?.answer({ kind: 'stale' });
    await flush();
    expect(states.at(-1)).toBe('conflict');
    s.save('c');
    expect(g.calls).toHaveLength(1);
  });

  it('a failed write reports an error and the next save retries with the same revision', async () => {
    const g = gate();
    const states: SaveState[] = [];
    const s = createDraftSaver({ revision: 7, put: g.put, onstate: (x) => states.push(x) });
    s.save('a');
    g.calls[0]?.answer({ kind: 'failed' });
    await flush();
    expect(states.at(-1)).toBe('error');
    s.save('b');
    expect(g.calls[1]).toMatchObject({ overlay: 'b', revision: 7 });
  });

  it('settled() resolves after every accepted edit is written, and revision() is then the new one', async () => {
    const g = gate();
    const s = createDraftSaver({ revision: 1, put: g.put, onstate: () => undefined });
    s.save('a');
    s.save('b');
    let done = false;
    const wait = s.settled().then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    g.calls[0]?.answer({ kind: 'saved', revision: 2 });
    await flush();
    g.calls[1]?.answer({ kind: 'saved', revision: 3 });
    await wait;
    expect(done).toBe(true);
    expect(s.revision()).toBe(3);
    expect(s.conflicted()).toBe(false);
  });

  it('settled() resolves at once when nothing was edited, and reports a conflict', async () => {
    const g = gate();
    const s = createDraftSaver({ revision: 1, put: g.put, onstate: () => undefined });
    await s.settled();
    s.save('a');
    g.calls[0]?.answer({ kind: 'stale' });
    await s.settled();
    expect(s.conflicted()).toBe(true);
  });
});
