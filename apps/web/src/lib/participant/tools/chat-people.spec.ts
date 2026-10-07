import { describe, expect, it } from 'vitest';
import { chatPeople } from './chat';

describe('chatPeople (the picker: every person who has the chat, as v3 listed them)', () => {
  it('lists the members the server named, by name, in name order, including people who never wrote', () => {
    expect(
      chatPeople([
        { id: 'zoe', name: 'Zoe' },
        { id: 'k6hjabcdef12345', name: 'anna' },
        { id: 'me', name: 'Mia' },
      ]),
    ).toEqual([
      { id: 'k6hjabcdef12345', name: 'anna' },
      { id: 'me', name: 'Mia' },
      { id: 'zoe', name: 'Zoe' },
    ]);
  });
  it('is empty before the first pull ("Keine Teilnehmer:innen")', () => {
    expect(chatPeople([])).toEqual([]);
  });
});
