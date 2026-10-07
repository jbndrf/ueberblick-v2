/**
 * What the chat tool needs from the device (B-020): the signed-in person, the names and feature labels that are on
 * the device (the owner rule: the device shows only what is on the device), who the picker offers, and the seed port.
 */
import type { ChatDeps, ChatPerson } from '@ueberblick/tool-chat';
import type { FeatureId } from '@ueberblick/core/model';
import type { ToolMember } from '@ueberblick/client';
import type { Device } from '../device';
import { participantName } from '../people';

/**
 * The picker's people: every person who has the chat, by name, as v3 listed them (`mentionable-participants`,
 * `chat.pb.js:168-239`). The server sends them with the stream (names only, the route's access rule) and the device
 * keeps them, so the list is on the device and works offline after the first pull.
 */
export function chatPeople(members: readonly ToolMember[]): readonly ChatPerson[] {
  return members.map((m) => ({ id: m.id, name: m.name })).sort((a, b) => a.name.localeCompare(b.name));
}

type ChatDevice = Pick<Device, 'participant' | 'store' | 'feature' | 'reader' | 'toolData' | 'chat'>;

export function chatDepsOf(device: ChatDevice, locale?: string): ChatDeps {
  const self = device.participant.id;
  const nameOf = (id: string): string | undefined =>
    participantName(
      { selfId: self, selfName: device.participant.name, personName: (who) => device.store.personName(who) },
      id,
    );
  return {
    self: () => self,
    nameOf,
    people: () => chatPeople(device.toolData.handle('chat').members()),
    featureLabel(id) {
      const state = device.feature(id as FeatureId);
      return state === undefined ? undefined : device.reader.labelOf(state, locale);
    },
    seed: device.chat.seed,
  };
}
