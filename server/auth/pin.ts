// Optional four-digit quick-unlock PIN. It only unlocks a session that was
// already opened with email + password; it can never sign anyone in.
// Hashed with scrypt and peppered with a key derived from the server secret,
// so a copied database alone is not enough to brute-force PINs offline.
import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AUTH_SECRET } from '../env.ts';

const scryptAsync = promisify(scrypt) as (pw: Buffer, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };
const pepper = createHmac('sha256', AUTH_SECRET).update('lumera-quick-unlock-pin').digest();

const peppered = (pin: string) => createHmac('sha256', pepper).update(pin).digest();

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(peppered(pin), salt, 32, PARAMS);
  return `s1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [v, saltB64, hashB64] = stored.split('$');
  if (v !== 's1' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(peppered(pin), Buffer.from(saltB64, 'base64'), expected.length, PARAMS);
  return timingSafeEqual(actual, expected);
}

export const MAX_PIN_ATTEMPTS = 5;
