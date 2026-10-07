import { isMobile } from '../../../breakpoint/is-mobile';

/** The kit's phone check, kept for its callers; it reads the one shared breakpoint (`src/breakpoint`, below 768 px). */
export class IsMobile {
  get current(): boolean {
    return isMobile();
  }
}
