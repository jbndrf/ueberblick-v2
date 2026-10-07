/**
 * `POST /api/admin/p/<project>/assets` (A-036): an admin uploads the project icon. The body is the image itself, the
 * `Content-Type` one of `BRANDING_ICON_TYPES`, at most `BRANDING_ICON_MAX_BYTES`. The bytes go to the project's blob
 * store (content-addressed); the answer carries the sha the project file stores as `branding.icon`.
 *
 *   201 { sha256, bytes, mime }   400 invalid_body (issues: content-type | body)   413 payload_too_large   401 / 403
 *
 * Admin only and project-scoped (`authorizeAdmin`, as the other admin endpoints). Downloading is the ordinary blob
 * route; the deployed config's icon is readable by every participant (`blobs/access.ts`).
 */
import { BRANDING_ICON_MAX_BYTES, BRANDING_ICON_TYPES } from '@ueberblick/core';
import type { Principal } from '../../auth/contract';
import type { BlobService } from '../../blobs/blobs';
import { errorResponse, jsonResponse } from '../shared/errors';
import { matchesImageType } from './sniff';

export interface AdminAssetsCall {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly principal: Principal | null;
}

export interface AdminAssetsDeps {
  /** The refusing response (401, 403, 404), or the authorised project key. */
  authorizeAdmin(principal: Principal | null, projectKey: string): { readonly projectKey: string } | Response;
  blobs(projectKey: string): BlobService;
}

export interface AdminAssetsHandlers {
  upload(call: AdminAssetsCall): Promise<Response>;
}

const tooLarge = (): Response =>
  errorResponse('payload_too_large', `An icon may be at most ${BRANDING_ICON_MAX_BYTES} bytes.`);

/** The body, or null when it is over the cap. Stops reading at the cap, so a huge upload is never buffered. */
async function readCapped(body: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > BRANDING_ICON_MAX_BYTES) return null;
    chunks.push(chunk);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export function createAdminAssetHandlers(deps: AdminAssetsDeps): AdminAssetsHandlers {
  return {
    async upload(call) {
      const auth = deps.authorizeAdmin(call.principal, call.params['project'] ?? '');
      if (auth instanceof Response) return auth;
      const req = call.request;
      const mime = (req.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      if (!BRANDING_ICON_TYPES.has(mime))
        return errorResponse('invalid_body', 'The file must be a PNG, JPEG, WebP or SVG image.', [
          { path: 'content-type', message: `'${mime}' is not an image type of the project icon.` },
        ]);
      const declared = Number(req.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > BRANDING_ICON_MAX_BYTES) return tooLarge();
      if (req.body === null) return errorResponse('invalid_body', 'The body is empty.');
      const bytes = await readCapped(req.body);
      if (bytes === null) return tooLarge();
      if (bytes.byteLength === 0) return errorResponse('invalid_body', 'The body is empty.');
      if (!matchesImageType(bytes, mime))
        return errorResponse('invalid_body', 'The bytes are not the image the content type names.', [
          { path: 'body', message: `The file is not a valid ${mime}.` },
        ]);
      const stored = await deps.blobs(auth.projectKey).put(
        (async function* () {
          yield bytes;
        })(),
        mime,
      );
      return jsonResponse({ sha256: stored.sha256, bytes: stored.bytes, mime }, 201);
    },
  };
}
