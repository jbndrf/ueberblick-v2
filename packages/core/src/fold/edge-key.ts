/** Identity of an edge; shared by fold, the server and the device store. The edge tombstone `id` of the sync protocol has this form. */
import type { Edge } from '../model';

export const edgeKey = (e: Pick<Edge, 'from' | 'relation' | 'to'>): string =>
  `${e.from}\u0000${e.relation}\u0000${e.to}`;
