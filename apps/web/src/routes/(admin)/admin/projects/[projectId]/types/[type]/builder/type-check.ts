/** Whether the draft's effective file has the feature type (Objektart) the address names. */
import { openProject } from '@ueberblick/builder';

export function draftHasType(templateSrc: string, overlaySrc: string, type: string): boolean {
  return openProject(templateSrc, overlaySrc).effective().types?.[type] !== undefined;
}
