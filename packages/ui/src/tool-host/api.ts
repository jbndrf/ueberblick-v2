// The authoring surface of the tool API. Tool packages import from `@ueberblick/ui/tool-api` (not the ui
// barrel), so a lazily loaded tool does not pull the design system with it.
export type * from './contract';
export {
  PRODUCIBLE_SHAPES,
  TOOL_API_VERSION,
  TOOL_HOST_ERROR_CODES,
  TOOL_AVAILABILITY,
  TOOL_CONTRIBUTIONS,
  isFieldTool,
  ToolHostError,
} from './contract';
export { defineTool } from './define';
export { fileAccepted } from '@ueberblick/core/form';
export { DEFAULT_MAX_FILES } from '@ueberblick/core/registry';
