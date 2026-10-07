/**
 * The one lookup from a participant id to the name the device knows (R1): the signed-in person's own name, else the
 * `people` of the sync page, clipped on the server by `activity_names` (WP-721). `undefined` for a stranger; the
 * readers show that as "Jemand", never the id (v3 `activity_unknown_actor`, WP-306 owner decision).
 */
export interface PeopleSource {
  readonly selfId: string;
  readonly selfName: string;
  readonly personName: (id: string) => string | undefined;
}

export function participantName(source: PeopleSource, id: string): string | undefined {
  return id === source.selfId ? source.selfName : source.personName(id);
}

/**
 * Labels for people in list order: the name, else `unknown` ("Jemand"), numbered ("Jemand 1", "Jemand 2") when several
 * are unnamed so they stay apart. The one place for this (R1): the filter's creators and the participant choices.
 */
export function labelPeople(
  people: readonly { readonly id: string; readonly name: string | undefined }[],
  unknown: string,
): { id: string; label: string }[] {
  const unnamed = people.filter((p) => p.name === undefined).length;
  let n = 0;
  return people.map((p) => ({ id: p.id, label: p.name ?? (unnamed > 1 ? `${unknown} ${++n}` : unknown) }));
}
