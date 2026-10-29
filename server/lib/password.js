import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;
const derive = (password, salt) =>
  new Promise((res, rej) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))),
  );

// Формат: scrypt$<соль base64>$<хэш base64>
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, s, k] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const expected = Buffer.from(k, 'base64');
  const actual = await derive(password, Buffer.from(s, 'base64'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Заглушка, чтобы вход с неизвестным ником занимал столько же времени, как с известным.
export const dummyHash = await hashPassword(randomBytes(16).toString('hex'));
