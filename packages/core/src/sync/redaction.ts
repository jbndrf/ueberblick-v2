import type { FeatureId } from '../model';
import { SyncProtocolError } from './errors';

/**
 * Id of a `redaction` tombstone: `<featureId>#<property>`, one tombstone per blanked property. A FeatureId is a
 * UUID and never contains '#', so the id is split at the FIRST '#' and a property key may contain '#'.
 */
const SEPARATOR = '#';

export function redactionKey(featureId: FeatureId, property: string): string {
  if (featureId === '' || featureId.includes(SEPARATOR) || property === '')
    throw new SyncProtocolError(
      'malformed',
      'redaction key: feature id and property must be non-empty, id without #',
    );
  return `${featureId}${SEPARATOR}${property}`;
}

export function parseRedactionKey(id: string): { featureId: FeatureId; property: string } {
  const at = id.indexOf(SEPARATOR);
  if (at <= 0 || at === id.length - 1)
    throw new SyncProtocolError('malformed', `redaction tombstone id ${id}: expected <featureId>#<property>`);
  return { featureId: id.slice(0, at) as FeatureId, property: id.slice(at + 1) };
}
