// @ueberblick/tool-measure: loaded lazily by the app (`() => import('@ueberblick/tool-measure')`).
import { createGeo } from '@ueberblick/core/geo';
import type { PanelTool } from '@ueberblick/ui/tool-api';
import { createMeasureTool } from './measure-tool';

export { createMeasureTool } from './measure-tool';
export { MEASURE_MODES, formatArea, formatLength, measure, overlayOf } from './model';
export type { MeasureMode, Measurement } from './model';

/** The tool the host mounts: core.geo with the JSTS engine. The position comes from the host's port. */
export const measureTool: PanelTool = createMeasureTool({ geo: createGeo() });
