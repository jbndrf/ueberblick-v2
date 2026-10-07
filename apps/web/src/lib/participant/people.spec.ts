import { describe, expect, it } from 'vitest';
import { labelPeople, participantName } from './people';

describe('labelPeople', () => {
  it('keeps names, numbers several unnamed in order, leaves a single one plain', () => {
    expect(
      labelPeople(
        [
          { id: 'a', name: 'Anna' },
          { id: 'b', name: undefined },
          { id: 'c', name: undefined },
        ],
        'Jemand',
      ),
    ).toEqual([
      { id: 'a', label: 'Anna' },
      { id: 'b', label: 'Jemand 1' },
      { id: 'c', label: 'Jemand 2' },
    ]);
    expect(labelPeople([{ id: 'b', name: undefined }], 'Someone')).toEqual([{ id: 'b', label: 'Someone' }]);
  });
});

describe('participantName', () => {
  it('own id gives the own name, others the synced one', () => {
    const src = { selfId: 'me', selfName: 'Ich', personName: (id: string) => (id === 'x' ? 'X' : undefined) };
    expect(participantName(src, 'me')).toBe('Ich');
    expect(participantName(src, 'x')).toBe('X');
    expect(participantName(src, 'y')).toBeUndefined();
  });
});
