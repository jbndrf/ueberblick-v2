// @ueberblick/tool-file: loaded lazily by the app (`() => import('@ueberblick/tool-file')`).
import type { FieldTool } from '@ueberblick/ui/tool-api';
import { createFileTool } from './file-tool';

export { createFileTool, V3_DEFAULT_ACCEPT } from './file-tool';

/** The tool the host mounts. */
export const fileTool: FieldTool = createFileTool();
