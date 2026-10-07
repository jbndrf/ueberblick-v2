/**
 * Shape checks for what the server sends before the device runtime exists. A reply that does not fit is refused with
 * a reason, never cast (v3 lesson 5). The check is of the shape only; core `hydrate` (run when the config is opened)
 * validates the compiled content itself. No import from the client or from core values: this is in the shell chunk.
 */
import type { CompiledConfigData } from '@ueberblick/core/hydrate';
import type { Bootstrap, BootstrapIdentity } from './http';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Why `body` is not a compiled config, or undefined when its shape fits. */
function compiledFault(body: unknown): string | undefined {
  if (!isObject(body)) return 'not an object';
  if (typeof body['format'] !== 'number') return 'no `format`';
  if (!isObject(body['file'])) return 'no `file`';
  if (typeof body['hash'] !== 'string') return 'no `hash`';
  if (!Array.isArray(body['expressions'])) return 'no `expressions`';
  return undefined;
}

/** The compiled config as sent, or a thrown error naming what is wrong. */
export function decodeCompiled(body: unknown): CompiledConfigData {
  const fault = compiledFault(body);
  if (fault !== undefined) throw new Error(`The compiled config is malformed: ${fault}.`);
  return body as CompiledConfigData;
}

export type DecodedBootstrap =
  { readonly ok: true; readonly bootstrap: Bootstrap } | { readonly ok: false; readonly reason: string };

/** Why `body` is not the identity part of a bootstrap (who, which project, session, own login), or undefined. */
function identityFault(body: Record<string, unknown>): string | undefined {
  const project = body['project'];
  if (!isObject(project) || typeof project['key'] !== 'string') return 'no `project.key`';
  if (typeof project['displayName'] !== 'string') return 'no `project.displayName`';
  if (project['icon'] !== null && typeof project['icon'] !== 'string')
    return '`project.icon` is neither a blob sha nor null';
  if (typeof project['preview'] !== 'boolean') return 'no `project.preview`';
  const p = body['participant'];
  if (!isObject(p) || typeof p['id'] !== 'string') return 'no `participant.id`';
  if (typeof p['name'] !== 'string') return 'no `participant.name`';
  if (!Array.isArray(p['roles']) || !p['roles'].every((r) => typeof r === 'string'))
    return '`participant.roles` is not a list of strings';
  for (const k of ['email', 'phone'])
    if (p[k] !== null && typeof p[k] !== 'string') return `\`participant.${k}\` is neither text nor null`;
  if (typeof body['version'] !== 'number') return 'no `version`';
  const session = body['session'];
  if (
    !isObject(session) ||
    typeof session['expiresAt'] !== 'string' ||
    Number.isNaN(Date.parse(session['expiresAt']))
  )
    return 'no `session.expiresAt` (an instant)';
  const login = body['login'];
  if (
    login !== null &&
    (!isObject(login) || typeof login['token'] !== 'string' || typeof login['link'] !== 'string')
  )
    return '`login` is neither `{ token, link }` nor null';
  return pagesFault(body);
}

const isLocalized = (v: unknown): boolean =>
  typeof v === 'string' ||
  (isObject(v) && Object.values(v).every((x) => typeof x === 'string') && Object.keys(v).length > 0);

/** Why the info pages or legal pages are not a list of the right shape, or undefined. */
function pagesFault(body: Record<string, unknown>): string | undefined {
  const info = body['infoPages'];
  if (
    !Array.isArray(info) ||
    !info.every(
      (x) =>
        isObject(x) && typeof x['key'] === 'string' && isLocalized(x['title']) && isLocalized(x['content']),
    )
  )
    return '`infoPages` is not a list of { key, title, content }';
  const legal = body['legalPages'];
  if (
    !Array.isArray(legal) ||
    !legal.every(
      (x) =>
        isObject(x) &&
        typeof x['slug'] === 'string' &&
        typeof x['title'] === 'string' &&
        typeof x['body'] === 'string',
    )
  )
    return '`legalPages` is not a list of { slug, title, body }';
  return undefined;
}

export function decodeBootstrap(body: unknown): DecodedBootstrap {
  const no = (reason: string): DecodedBootstrap => ({ ok: false, reason });
  if (!isObject(body)) return no('the bootstrap is not an object');
  const fault = identityFault(body);
  if (fault !== undefined) return no(fault);
  if (body['access'] !== undefined && typeof body['access'] !== 'string') return no('`access` is not text');
  const compiledProblem = compiledFault(body['compiled']);
  if (compiledProblem !== undefined) return no(`the compiled config: ${compiledProblem}`);
  return { ok: true, bootstrap: body as unknown as Bootstrap };
}

/** The identity part of a bootstrap or a start: everything the header and the profile card show, no compiled config. */
export function identityOf(b: BootstrapIdentity): BootstrapIdentity {
  return {
    project: b.project,
    participant: b.participant,
    version: b.version,
    session: b.session,
    login: b.login,
    infoPages: b.infoPages,
    legalPages: b.legalPages,
  };
}

/** The version of the cached identity record. An unknown version is refused, never read (R11). */
export const BOOTSTRAP_CACHE_FORMAT = 4;

/**
 * The identity as it is written to `localStorage` (WP-772): without the reusable login token, which any page script
 * could read there. Offline the info pages then show no token or link; online the bootstrap carries them in memory.
 */
export function cachedIdentityOf(b: BootstrapIdentity): BootstrapIdentity {
  return { ...identityOf(b), login: null };
}

/** The cached identity (the bootstrap without its compiled config), or undefined for text of another shape. */
export function decodeCachedIdentity(text: string): BootstrapIdentity | undefined {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(body) || body['format'] !== BOOTSTRAP_CACHE_FORMAT || !isObject(body['identity']))
    return undefined;
  const identity = body['identity'];
  return identityFault(identity) === undefined ? (identity as unknown as BootstrapIdentity) : undefined;
}
