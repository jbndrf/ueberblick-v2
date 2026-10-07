/** `@ueberblick/ui/testing` (WP-628): test helpers for specs outside packages/ui. Importing it installs the jsdom shims
 * (ResizeObserver, matchMedia) and exports the axe helper. Production code must not import it (`no-testing-helpers-in-prod`). */
import '../components/ui/jsdom-shims.testing';

export { axeViolations } from './axe';
