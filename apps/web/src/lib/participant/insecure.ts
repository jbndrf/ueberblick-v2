/** Plain http is not a secure context: the device runtime refuses to start there (`InsecureContextError`, WP-595). */
import { InsecureContextError } from '@ueberblick/client';

/** The startup notice for an error from opening the device: the https notice, or "could not be loaded". */
export type StartupNotice = 'insecure_context' | 'load_failed';

export function startupNotice(error: unknown): StartupNotice {
  return error instanceof InsecureContextError ? 'insecure_context' : 'load_failed';
}

/** The same page over https, as the address hint. */
export const httpsAddress = (l: {
  readonly host: string;
  readonly pathname: string;
  readonly search: string;
}): string => `https://${l.host}${l.pathname}${l.search}`;
