import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const roomAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createToken() {
  return randomBytes(24).toString('base64url');
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenMatches(token: string, expectedHash: string) {
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createRoomCode() {
  const bytes = randomBytes(6);
  return [...bytes].map((byte) => roomAlphabet[byte % roomAlphabet.length]).join('');
}

export function readBearerToken(header: string | undefined) {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}
