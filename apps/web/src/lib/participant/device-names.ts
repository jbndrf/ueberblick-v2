/** The names a participant's data lives under on this device, in one place so the wipe at sign-out finds what the device wrote (R1). */
export const deviceName = (project: string, participant: string): string => `ub-${project}-${participant}`;
/** The tool data database next to the device store. */
export const toolDataName = (name: string): string => `${name}-tooldata`;
export const thumbsName = (project: string, participant: string): string =>
  `ueberblick-thumbs:${project}:${participant}`;
export const draftScope = (project: string, participant: string): string => `${project}:${participant}`;
/** Prefix of every draft key of one participant (`createDraftStore` appends the draft's own key). */
export const draftKeyPrefix = (scope: string): string => `ub:draft:${scope}:`;
export const initKey = (name: string): string => `ub:init:${name}`;
/** The draft photo shelf (WP-811): bytes of photos in drafts that are not yet a stored run. */
export const draftBlobsName = (project: string, participant: string): string =>
  `ub-draftblobs:${project}:${participant}`;
