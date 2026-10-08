// The API as Supabase runs it: public address https://<ref>.supabase.co/functions/v1,
// but requests reach the server with "/functions/v1" removed. Sign-up,
// sign-in and sign-out must still work, with bearer tokens from another
// origin (the web app on GitHub Pages).
//
//   npm run test:edge
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8900 + Math.floor(Math.random() * 90);
const API = `http://localhost:${PORT}`;
const WEB_ORIGIN = 'http://localhost:5999';
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'lumera-edge-'));
const env = { ...process.env, NODE_ENV: 'development', DATA_DIR, PORT: String(PORT), APP_URL: `${WEB_ORIGIN}/agency-dashboard`, API_URL: `${API}/functions/v1`, ADMIN_SIGNUP_CODE: '2580', DATABASE_URL: '' };

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗'} ${label}\x1b[0m ${ok || detail === undefined ? '' : JSON.stringify(detail)}`);
};
const post = (p: string, body: unknown, token?: string) =>
  fetch(API + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN, 'X-Lumera-Client': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], { cwd: ROOT, env, stdio: 'ignore' });
try {
  for (let i = 0; i < 80; i++) {
    if (await fetch(`${API}/api/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log('Supabase-style paths');
  const signUp = await post('/api/auth/sign-up/email', { name: 'Edge Test', email: 'edge@lumera.test', password: 'quiet-meadow-anchor-31', admin: true, adminCode: '2580' });
  const token = signUp.headers.get('set-auth-token') ?? '';
  check('sign-up works and returns a bearer token', signUp.status === 200 && Boolean(token), signUp.status);
  check('CORS allows the web app origin', signUp.headers.get('access-control-allow-origin') === WEB_ORIGIN);
  const me = await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  check('the token opens the session', me.status === 200 && (await me.json()).workspace?.role === 'owner');
  const signIn = await post('/api/auth/sign-in/email', { email: 'edge@lumera.test', password: 'quiet-meadow-anchor-31' });
  check('sign-in works', signIn.status === 200 && Boolean(signIn.headers.get('set-auth-token')), signIn.status);
  const wrong = await post('/api/auth/sign-in/email', { email: 'edge@lumera.test', password: 'wrong-password-here-9' });
  check('a wrong password is refused with its own message', wrong.status === 401 && (await wrong.json()).code === 'INVALID_EMAIL_OR_PASSWORD', wrong.status);
  const out = await post('/api/auth/sign-out', {}, token);
  check('sign-out works', out.status === 200, out.status);
  const after = await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  check('the token stops working after sign-out', after.status === 401, after.status);
} catch (err) {
  failures++;
  console.error(err);
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  rmSync(DATA_DIR, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
