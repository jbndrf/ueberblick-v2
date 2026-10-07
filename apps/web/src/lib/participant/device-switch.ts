/** Which device a start gets: the open one, updated in place for the same person, or a new one for another (WP-796). */
import { openDevice, type Device, type DevicePorts } from './device';
import type { DeviceStart } from './http';

/**
 * Takeover: a start for another participant (or project) than the open device closes it and opens the newcomer's; the
 * first one's database stays on disk (`ub-<project>-<participant>`), as v3 kept `participant-state__<id>`. The same
 * participant keeps the open device even when the roles differ (WP-796): the roles are applied in place, as v3's live
 * `roles` collection did, and the queue, the drafts and the open sheets stay.
 */
export async function switchDevice(
  current: Device | undefined,
  bootstrap: DeviceStart,
  ports: DevicePorts,
  locale: string,
): Promise<Device> {
  if (
    current !== undefined &&
    current.project === bootstrap.project.key &&
    current.participant.id === bootstrap.participant.id
  ) {
    current.updateRoles(bootstrap.participant.roles);
    return current;
  }
  current?.close();
  return openDevice(bootstrap, ports, locale);
}
