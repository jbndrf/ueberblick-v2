/**
 * Publishing a template version (docs/05 "Minor versions"): a version stays inside its major only
 * when `template.breakingChanges` finds nothing; a new major may break. Pure. The server route calls
 * this same check, so the lens and the API cannot disagree (R1). It lives in core since WP-395, so `packages/server`
 * can run it without the builder.
 */
import type { PublishRefusal } from '../registry/admin';
import type { TemplateFile } from '../schema';
import { breakingChanges } from './breaking';
import type { BreakingChange } from './contract';

/** What publishing a template version answers (YAML text in): stored, refused by the check, unreadable, or failed. */
export type PublishOutcome =
  | { readonly ok: true; readonly created: boolean }
  | {
      readonly ok: false;
      readonly reason: 'refused';
      readonly codes: readonly PublishRefusal[];
      readonly messages: readonly string[];
    }
  | { readonly ok: false; readonly reason: 'invalid'; readonly messages: readonly string[] }
  | { readonly ok: false; readonly reason: 'failed' };

export type PublishCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reasons: readonly { readonly code: PublishRefusal; readonly message: string }[];
      /** The breaking changes, when that is (one of) the reason(s). */
      readonly breaking: readonly BreakingChange[];
    };

const parts = (v: string): number[] => (v.split('-')[0] ?? '').split('.').map((n) => Number(n) || 0);

/** Positive when `a` is a higher version than `b`. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** `previous` is the highest published version below `next` of the same key, if any. */
export function checkPublish(previous: TemplateFile | undefined, next: TemplateFile): PublishCheck {
  if (previous === undefined) return { ok: true };
  const reasons: { code: PublishRefusal; message: string }[] = [];
  let breaking: readonly BreakingChange[] = [];
  const [before, after] = [previous.template, next.template];
  if (before.key !== after.key)
    reasons.push({
      code: 'key_changed',
      message: `The key is ${after.key}, the previous version is ${before.key}.`,
    });
  else if (compareVersions(after.version, before.version) <= 0)
    reasons.push({
      code: 'version_not_higher',
      message: `${after.version} is not higher than ${before.version}.`,
    });
  else if (parts(after.version)[0] === parts(before.version)[0]) {
    breaking = breakingChanges(previous, next);
    if (breaking.length > 0)
      reasons.push({
        code: 'breaking_in_minor',
        message: `${after.version} stays in major ${parts(after.version)[0]} but removes or changes ${breaking.length} keys.`,
      });
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons, breaking };
}
