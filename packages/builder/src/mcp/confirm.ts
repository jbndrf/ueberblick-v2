/**
 * The human confirmation (O15): `apply` needs a token that names exactly one change, the ops on one
 * draft revision. The token is a signature over (project, revision, resulting overlay text) and an
 * expiry, so it cannot be moved to other ops, another revision or another project. It is issued by a
 * human step (`issueConfirmation`, the route `POST /api/mcp/<project>/confirm` behind the builder's
 * "apply this proposal" action), never by a tool an assistant can call. Seam: a different policy
 * (execute under limits) is another `ConfirmationPort`, not another write path.
 */
import type { ConfirmationPort, DraftPort } from './contract';
import { applyOps, type Refusal } from './proposal';
import { ConfirmInput } from './schemas';

const message = (project: string, revision: number, overlay: string, expires: number): string =>
  JSON.stringify([project, revision, overlay, expires]);

const sameText = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** A token for the change these ops make; `expires` is milliseconds since the epoch. */
export function mint(
  port: ConfirmationPort,
  project: string,
  revision: number,
  overlay: string,
): { readonly token: string; readonly expires: number } {
  const expires = port.now() + port.ttlMs;
  return { token: `${expires}.${port.sign(message(project, revision, overlay, expires))}`, expires };
}

/** `ok`, or why not: a token that does not fit the change (`expired: false`) or one that is too old. */
export type TokenCheck = { readonly ok: true } | { readonly ok: false; readonly expired: boolean };

export function verify(
  port: ConfirmationPort,
  token: string,
  project: string,
  revision: number,
  overlay: string,
): TokenCheck {
  const dot = token.indexOf('.');
  const expires = Number(token.slice(0, dot));
  if (dot < 1 || !Number.isSafeInteger(expires)) return { ok: false, expired: false };
  const expected = port.sign(message(project, revision, overlay, expires));
  if (!sameText(expected, token.slice(dot + 1))) return { ok: false, expired: false };
  return port.now() > expires ? { ok: false, expired: true } : { ok: true };
}

export type Issued =
  | { readonly ok: true; readonly token: string; readonly expires: number }
  | { readonly ok: false; readonly refusal: Refusal };

/**
 * The human step: the ops as the person saw them in the proposal, on the draft revision they saw (a
 * body checked like the input of `apply`). A changed draft or a refused op yields no token.
 */
export async function issueConfirmation(
  ctx: { readonly project: string; readonly draft: DraftPort; readonly confirmation: ConfirmationPort },
  requestBody: unknown,
): Promise<Issued> {
  const parsed = ConfirmInput.safeParse(requestBody);
  if (!parsed.success)
    return {
      ok: false,
      refusal: {
        code: 'invalid_input',
        message: 'Send { ops, baseRevision } as in the proposal.',
        issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`),
      },
    };
  const request = parsed.data;
  const read = await ctx.draft.read();
  if (!read.ok) return { ok: false, refusal: { code: read.code, message: read.message } };
  if (read.draft.revision !== request.baseRevision)
    return {
      ok: false,
      refusal: { code: 'stale_revision', message: 'The draft changed since the proposal; propose again.' },
    };
  const applied = applyOps(read.draft, request.ops);
  if (!applied.ok) return applied;
  const t = mint(ctx.confirmation, ctx.project, request.baseRevision, applied.after.save().overlaySrc);
  return { ok: true, ...t };
}
