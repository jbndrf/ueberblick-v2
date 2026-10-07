import type { ErrorEnvelope, Issue } from './contract';
import { HTTP_ERRORS, type HttpErrorCode } from './registry';

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function errorResponse(code: HttpErrorCode, message: string, issues?: readonly Issue[]): Response {
  const body: ErrorEnvelope = { error: { code, message, ...(issues ? { issues } : {}) } };
  return jsonResponse(body, HTTP_ERRORS.get(code).status);
}
