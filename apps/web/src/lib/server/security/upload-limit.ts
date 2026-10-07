/**
 * The upload limit (`UPLOAD_LIMIT`): a request that declares a body above it is refused with 413 before any handler
 * reads it. A body without a declared length is bounded by adapter-node's `BODY_SIZE_LIMIT`, which the image sets from
 * the same variable (`scripts/docker/entrypoint.sh`).
 */
export function uploadLimitRefusal(request: Request, maxBytes: number): Response | undefined {
  const declared = request.headers.get('content-length');
  if (declared === null || !/^\d+$/.test(declared) || Number(declared) <= maxBytes) return undefined;
  return Response.json({ error: 'payload_too_large' }, { status: 413 });
}
