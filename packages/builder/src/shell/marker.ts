/**
 * A stable string that ends up in every bundle chunk that contains the builder shell (it is rendered
 * as `data-builder` on the shell root, so minifiers keep it). The e2e bundle check looks for it to
 * prove builder code stays out of the participant bundle. Change it only together with that check.
 */
export const BUILDER_BUNDLE_MARKER = 'ueberblick-builder-shell-v1';
