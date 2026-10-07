// The certificates of HTTPS_MODE=direct (WP-941): a local CA (about 10 years) and a server certificate for every IP
// and name in LOCAL_HOSTS (SAN), kept in `<dir>` (`/data/tls`). Phones trust the CA once; the server certificate
// can then be reissued whenever the hosts change without asking them again.
//
// The one entry is `loadTlsMaterial`. Own certificate files (`TLS_CERT_FILE`, `TLS_KEY_FILE`, step-1-plan) are a
// second source behind this same function; its callers (the front) never learn where the material came from.
import {
  X509Certificate,
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import {
  bitString,
  boolean,
  explicit,
  integer,
  ipBytes,
  octetString,
  oid,
  sequence,
  set,
  smallInteger,
  time,
  tlv,
  utf8,
} from './asn1.mjs';

const DAY = 86_400_000;
const CA_DAYS = 3650;
/** Current iOS and Chrome reject server certificates valid for more than 398 days. */
const SERVER_DAYS = 397;
/** A server certificate with less than this left is reissued on the next start or by the front's daily check. */
const RENEW_BEFORE_DAYS = 30;

const OID = {
  ecdsaSha256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  subjectKeyId: '2.5.29.14',
  keyUsage: '2.5.29.15',
  altName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  authorityKeyId: '2.5.29.35',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
};

const name = (cn) =>
  sequence(
    set(sequence(oid(OID.organization), utf8('Ueberblick'))),
    set(sequence(oid(OID.commonName), utf8(cn))),
  );
const extension = (id, value, critical = false) =>
  sequence(oid(id), ...(critical ? [boolean(true)] : []), octetString(value));
const keyId = (spki) => createHash('sha1').update(spki).digest();
const pem = (label, der) =>
  `-----BEGIN ${label}-----\n${(der.toString('base64').match(/.{1,64}/g) ?? []).join('\n')}\n-----END ${label}-----\n`;

/** Canonical text of an address or name, so the SAN of a certificate can be compared with LOCAL_HOSTS. */
const canon = (host) =>
  isIP(host) === 6 ? new URL(`http://[${host}]`).hostname.slice(1, -1) : host.toLowerCase();

/** The IPs and names in the SAN of a certificate. @param {X509Certificate} cert */
export function sanOf(cert) {
  return (cert.subjectAltName ?? '')
    .split(', ')
    .filter((e) => e !== '')
    .map((e) => canon(e.replace(/^(DNS|IP Address):/, '')));
}

function buildCertificate({ subject, issuer, publicKey, signKey, now, days, extensions }) {
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const serial = randomBytes(16);
  serial[0] = (serial[0] ?? 0) & 0x7f;
  const sigAlg = sequence(oid(OID.ecdsaSha256));
  const tbs = sequence(
    explicit(0, smallInteger(2)),
    integer(serial),
    sigAlg,
    name(issuer),
    sequence(time(new Date(now.getTime() - DAY)), time(new Date(now.getTime() + days * DAY))),
    name(subject),
    spki,
    explicit(3, sequence(...extensions(spki))),
  );
  return sequence(tbs, sigAlg, bitString(sign('sha256', tbs, signKey))).toString('base64');
}

const keyPair = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });
const privatePem = (key) => key.export({ type: 'pkcs8', format: 'pem' });
const derOf = (b64) => Buffer.from(b64, 'base64');

function createCa(now) {
  const { publicKey, privateKey } = keyPair();
  const b64 = buildCertificate({
    subject: 'Ueberblick Local CA',
    issuer: 'Ueberblick Local CA',
    publicKey,
    signKey: privateKey,
    now,
    days: CA_DAYS,
    extensions: (spki) => [
      extension(OID.basicConstraints, sequence(boolean(true)), true),
      extension(OID.keyUsage, bitString(Buffer.from([0x06]), 1), true),
      extension(OID.subjectKeyId, octetString(keyId(spki))),
    ],
  });
  return { certPem: pem('CERTIFICATE', derOf(b64)), keyPem: privatePem(privateKey) };
}

function createServer(ca, hosts, now) {
  const { publicKey, privateKey } = keyPair();
  const caCert = new X509Certificate(ca.certPem);
  const names = hosts.map((h) =>
    isIP(h) !== 0 ? tlv(0x87, ipBytes(h)) : tlv(0x82, Buffer.from(h, 'ascii')),
  );
  const b64 = buildCertificate({
    subject: 'Ueberblick',
    issuer: 'Ueberblick Local CA',
    publicKey,
    signKey: createPrivateKey(ca.keyPem),
    now,
    days: SERVER_DAYS,
    extensions: (spki) => [
      extension(OID.basicConstraints, sequence()),
      extension(OID.keyUsage, bitString(Buffer.from([0x80]), 7), true),
      extension(OID.extKeyUsage, sequence(oid(OID.serverAuth))),
      extension(OID.altName, sequence(...names)),
      extension(OID.subjectKeyId, octetString(keyId(spki))),
      extension(
        OID.authorityKeyId,
        sequence(tlv(0x80, keyId(caCert.publicKey.export({ type: 'spki', format: 'der' })))),
      ),
    ],
  });
  return { certPem: pem('CERTIFICATE', derOf(b64)), keyPem: privatePem(privateKey) };
}

function write(file, text, mode) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, { mode });
  renameSync(tmp, file);
}

const readCa = (dir) => {
  try {
    const certPem = readFileSync(join(dir, 'ca.crt'), 'utf8');
    const keyPem = readFileSync(join(dir, 'ca.key'), 'utf8');
    const cert = new X509Certificate(certPem);
    createPrivateKey(keyPem);
    return cert.ca && new Date(cert.validTo) > new Date() ? { certPem, keyPem, cert } : null;
  } catch {
    return null;
  }
};

/** Does the stored server certificate still serve exactly these hosts, chain to this CA and have time left? */
const serverIsCurrent = (dir, hosts, caCert, now) => {
  try {
    const cert = new X509Certificate(readFileSync(join(dir, 'server.crt'), 'utf8'));
    createPrivateKey(readFileSync(join(dir, 'server.key'), 'utf8'));
    const have = sanOf(cert).sort();
    const want = hosts.map(canon).sort();
    return (
      have.length === want.length &&
      have.every((h, i) => h === want[i]) &&
      cert.verify(caCert.publicKey) &&
      cert.validToDate.getTime() - now.getTime() > RENEW_BEFORE_DAYS * DAY
    );
  } catch {
    return false;
  }
};

/**
 * The TLS material of the direct mode: reuses what is in `dir`, creates the CA on first start and reissues the
 * server certificate when `hosts` changed, it is nearly expired or no longer chains to the CA.
 * The CA key stays on disk; only the public CA certificate and the server pair are returned.
 *
 * @param {{ dir: string, hosts: readonly string[], now?: Date }} options
 * @returns {{ ca: { certPem: string }, server: { certPem: string, keyPem: string }, created: { ca: boolean, server: boolean } }}
 */
export function loadTlsMaterial({ dir, hosts, now = new Date() }) {
  if (hosts.length === 0)
    throw new Error('LOCAL_HOSTS is empty: the certificate needs at least one IP or name');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let ca = readCa(dir);
  const createdCa = ca === null;
  if (ca === null) {
    const made = createCa(now);
    write(join(dir, 'ca.key'), made.keyPem, 0o600);
    write(join(dir, 'ca.crt'), made.certPem, 0o644);
    ca = { ...made, cert: new X509Certificate(made.certPem) };
  }
  const createdServer = createdCa || !serverIsCurrent(dir, hosts, ca.cert, now);
  if (createdServer) {
    const made = createServer(ca, hosts, now);
    write(join(dir, 'server.key'), made.keyPem, 0o600);
    write(join(dir, 'server.crt'), made.certPem, 0o644);
  }
  return {
    ca: { certPem: ca.certPem },
    server: {
      certPem: readFileSync(join(dir, 'server.crt'), 'utf8'),
      keyPem: readFileSync(join(dir, 'server.key'), 'utf8'),
    },
    created: { ca: createdCa, server: createdServer },
  };
}
