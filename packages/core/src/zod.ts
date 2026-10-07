/**
 * The one zod configuration (R1). zod's JIT probes `new Function("")` on the first object parse. The enforced
 * Content-Security-Policy (no `unsafe-eval`, WP-942) reports that probe as a violation even though zod catches the
 * throw. The schemas are small, so parsing without the JIT costs nothing noticeable. Every value import of zod goes through this module (spec-enforced), so
 * whoever brings zod also brings the config and the participant shell never imports zod just to configure it.
 */
import { z } from 'zod';

z.config({ jitless: true });

export { z };
