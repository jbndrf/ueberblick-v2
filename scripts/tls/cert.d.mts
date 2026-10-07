import type { X509Certificate } from 'node:crypto';

export interface TlsMaterial {
  /** The public CA certificate (PEM). The CA key never leaves its file. */
  readonly ca: { readonly certPem: string };
  readonly server: { readonly certPem: string; readonly keyPem: string };
  /** What this call had to create (false: reused from the folder). */
  readonly created: { readonly ca: boolean; readonly server: boolean };
}
export function loadTlsMaterial(options: { dir: string; hosts: readonly string[]; now?: Date }): TlsMaterial;
export function sanOf(cert: X509Certificate): string[];
