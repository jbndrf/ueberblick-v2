/**
 * The wire shape of `GET /builder-api/<project>/preview` (WP-373): what the preview is doing and its logins. Declared here
 * (no server import at run time) so the browser code and `handlers/preview.ts` agree.
 */
export interface PreviewLoginView {
  /** The role key; null is "Keine Rolle" (the component words it). */
  readonly role: string | null;
  /** The role's name in the asked locale; empty for "Keine Rolle". */
  readonly label: string;
  readonly participantId: string;
  readonly token: string;
  /** Relative: `/login?token=…`. */
  readonly link: string;
}

export interface PreviewView {
  /** `dropped`: there is no preview yet. */
  readonly status: 'ready' | 'stale' | 'dropped';
  readonly logins: readonly PreviewLoginView[];
}

export const isPreviewView = (v: unknown): v is PreviewView =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as PreviewView).status === 'string' &&
  Array.isArray((v as PreviewView).logins);
