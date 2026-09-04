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
  return createReadableSecret(6);
}

export function createAdminPassword() {
  const value = createReadableSecret(12);
  return value.match(/.{4}/g)?.join('-') ?? value;
}

export function readBearerToken(header: string | undefined) {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

function createReadableSecret(length: number) {
  const bytes = randomBytes(length);
  return [...bytes].map((byte) => roomAlphabet[byte % roomAlphabet.length]).join('');
}
