import { randomBytes, scrypt } from 'node:crypto';
import { safeEqual } from './crypto';
import { PASSWORD_PARAMS, SCRYPT_MAXMEM } from './params';

function derive(
  password: string,
  salt: Uint8Array,
  n: number,
  r: number,
  p: number,
  keyLen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLen, { N: n, r, p, maxmem: SCRYPT_MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Format: `scrypt$n$r$p$salt$hash` (base64url), so parameters can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const { n, r, p, keyLen, saltLen } = PASSWORD_PARAMS;
  const salt = randomBytes(saltLen);
  const key = await derive(password, salt, n, r, p, keyLen);
  return ['scrypt', n, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await derive(
    password,
    Buffer.from(salt, 'base64url'),
    Number(n),
    Number(r),
    Number(p),
    expected.length,
  );
  return safeEqual(key, expected);
}
