// The admin sign-in and deploy sequence over HTTP, shared by `ui.mjs seed` and `npm run demo` (R1): one copy.
// `base` is the origin of a running web app ("http://127.0.0.1:4173").

/** Signs in as an admin (email, password, TOTP code). Returns the session cookies as `{ name, value, url }`. */
export async function adminLogin(base, { email, password, totp }) {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, totp }),
  });
  if (login.status !== 200) throw new Error(`login as the seeded admin failed: HTTP ${login.status}`);
  return login.headers.getSetCookie().map((c) => {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
  });
}

/** Deploys one overlay file (parsed) to a project through the admin API; throws unless it was accepted. */
export async function deployOverlay(base, cookies, key, overlay, label = key) {
  const deploy = await fetch(`${base}/api/admin/p/${key}/deploy`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    },
    body: JSON.stringify(overlay),
  });
  const deployed = await deploy.json();
  if (deployed.ok !== true) throw new Error(`deploying ${label} failed: ${JSON.stringify(deployed)}`);
  return deployed;
}
