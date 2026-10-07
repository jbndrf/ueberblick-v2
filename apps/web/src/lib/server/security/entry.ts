/**
 * What a request must pass before any handler sees it (WP-941, WP-942): the transport gate (trusted proxy headers,
 * direct-mode redirect to https), then the upload limit. An early answer carries the security headers like any other;
 * HSTS follows what the gate saw (the client used HTTPS through the front or a trusted proxy).
 */
import type { Gate, GateConfig } from '../tls/gate';
import { transportGate } from '../tls/gate';
import { withSecurityHeaders } from './headers';
import { uploadLimitRefusal } from './upload-limit';

export interface Entry {
  readonly gate: Gate;
  /** The redirect or the 413, with security headers; undefined when the request may continue. */
  readonly early: Response | undefined;
}

export function entryGuard(input: {
  config: GateConfig;
  uploadLimitBytes: number;
  request: Request;
  peer: string;
  path: string;
}): Entry {
  const { config, uploadLimitBytes, request, peer, path } = input;
  const gate = transportGate({ config, peer, headers: request.headers, path });
  if (gate.redirect !== null)
    return {
      gate,
      early: withSecurityHeaders(
        new Response(null, { status: 308, headers: { location: gate.redirect } }),
        gate.https,
      ),
    };
  const tooLarge = uploadLimitRefusal(request, uploadLimitBytes);
  return { gate, early: tooLarge ? withSecurityHeaders(tooLarge, gate.https) : undefined };
}
