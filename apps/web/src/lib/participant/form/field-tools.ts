import type { Key } from '@ueberblick/core/model';
import { browserPosition, createToolHost, webCryptoHash } from '@ueberblick/ui';
import type { ToolHost } from '@ueberblick/ui';
import type { Device } from '../device';
import type { Locale } from '../messages';
import { fieldOptions, toolLoaders } from '../tools';

/**
 * Deliberately no `person` (WP-743): field tools (photo, file, draw) are form inputs that are always on, as in v3 (its
 * tools sheet lists only panel tools, `ToolsSheet.svelte:30-65`). Only panel tools follow role and person switches
 * (`ToolPanel.svelte`). Passing `person` here would switch field tools off for every role whose `app.tools` does not
 * list them.
 *
 * The tool host of one device for the fields of a task on `type` (photos, search, geometry ...). One place for every form (R1). */
export function fieldToolHost(
  device: Pick<Device, 'config' | 'geo' | 'blobs' | 'roleKey'>,
  type: Key | undefined,
  locale: Locale,
  center: () => readonly [number, number] | undefined,
): ToolHost {
  const file = device.config.file;
  return createToolHost({
    loaders: toolLoaders({
      geo: async () => device.geo,
      primaryGeometry: (t) => device.config.foldTypes.get(t)?.primaryGeometry,
      searchSettings: file.tools?.['search'] ?? {},
    }),
    ports: { blobs: device.blobs, hash: webCryptoHash, position: browserPosition },
    locale,
    optionsFor: fieldOptions({ file, roleKey: device.roleKey ?? '', type, center }),
  });
}
