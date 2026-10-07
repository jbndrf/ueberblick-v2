/**
 * Framework-agnostic HTTP handlers (WP-105). CONTRACT: changes need the lead.
 *
 * A handler is a Web `Request -> Response` function; SvelteKit route files only delegate to it. Errors always use
 * the envelope `{error: {code, message, issues?}}` (`ErrorEnvelope`), codes from `HTTP_ERRORS`.
 */
import type { Actor } from '@ueberblick/core';
import type { Auth, Principal } from '../../auth';
import type { HttpErrorCode } from './registry';

type Params = Readonly<Record<string, string>>;

/** Path parameters of the route the handler is mounted on. */
export interface HandlerContext<P extends Params = Params> {
  readonly params: P;
}

export type Handler<P extends Params = Params> = (req: Request, ctx: HandlerContext<P>) => Promise<Response>;

/** One problem inside a request body: `path` is dotted (`runs.3.task`), empty for the body itself. */
export interface Issue {
  readonly path: string;
  readonly message: string;
}

export interface ErrorEnvelope {
  readonly error: {
    readonly code: HttpErrorCode;
    readonly message: string;
    readonly issues?: readonly Issue[];
  };
}

/** Size limits; every field is configurable, these are the defaults. */
export interface HttpLimits {
  /** Body of a single run. */
  readonly maxBodyBytes: number;
  /** Body of a batch. */
  readonly maxBatchBodyBytes: number;
  /** Runs in one batch. */
  readonly maxBatchRuns: number;
}

export const DEFAULT_HTTP_LIMITS: HttpLimits = {
  maxBodyBytes: 256 * 1024,
  maxBatchBodyBytes: 8 * 1024 * 1024,
  maxBatchRuns: 500,
};

/** What a project endpoint needs to know who is calling. `Runtime` (apps/web) satisfies it structurally. */
export interface ProjectAccessDeps {
  readonly auth: Pick<Auth, 'authenticate' | 'toActor' | 'rolesFor'>;
  /** The project row for a key, or undefined. */
  project(key: string): { readonly id: string; readonly key: string } | undefined;
}

/** A caller who may act in a project; `actor` is what runs are recorded as. */
export interface ProjectCaller {
  readonly project: { readonly id: string; readonly key: string };
  readonly principal: Principal;
  readonly actor: Actor;
}

/** Upload limit of the blob route (WP-604). A deployment may override it through the runtime composition. */
export interface BlobLimits {
  /** Bytes of one uploaded file. */
  readonly maxUploadBytes: number;
}

export const DEFAULT_BLOB_LIMITS: BlobLimits = { maxUploadBytes: 50 * 1024 * 1024 };
