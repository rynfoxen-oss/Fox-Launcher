import { createHash } from 'crypto';
import type { Account } from '../shared/types';

/** Crockford-style alphabet with ambiguous characters removed. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const FRIEND_PREFIX = 'FOX-';
export const PARTY_PREFIX = 'FOXP-';

export function shortCodeFromSeed(prefix: string, seed: string): string {
  const digest = createHash('sha256').update(seed).digest('hex');
  let bits = BigInt(`0x${digest.slice(0, 12)}`);
  let body = '';
  for (let index = 0; index < 5; index += 1) {
    body = ALPHABET[Number(bits & 31n)] + body;
    bits >>= 5n;
  }
  const checkSource = createHash('sha256').update(body).digest('hex').slice(0, 4);
  const check = ALPHABET[Number(BigInt(`0x${checkSource}`) & 31n)];
  return `${prefix}${body}${check}`;
}

/** Stable, short friend code derived from the account only — never email or password. */
export function friendShortCode(account: Pick<Account, 'uuid' | 'name' | 'type'>): string {
  return shortCodeFromSeed(FRIEND_PREFIX, `${account.type}:${account.uuid || account.name.toLowerCase()}`);
}

/** Short party code derived from the persistent party id. */
export function partyShortCode(partyId: string): string {
  return shortCodeFromSeed(PARTY_PREFIX, `party:${partyId}`);
}

export function normalizeShortCode(value: string, prefix: string): string {
  const raw = value.trim().toUpperCase().replace(/\s+/g, '');
  if (!raw.startsWith(prefix)) return '';
  const body = raw.slice(prefix.length).replace(/-/g, '');
  if (body.length !== 6) return '';
  return `${prefix}${body}`;
}

export function isValidShortCode(value: string, prefix: string): boolean {
  const normalized = normalizeShortCode(value, prefix);
  if (!normalized) return false;
  const body = normalized.slice(prefix.length);
  return [...body].every((char) => ALPHABET.includes(char));
}

/** Full checksum validation for short codes. */
export function verifyShortCode(value: string, prefix: string): boolean {
  const normalized = normalizeShortCode(value, prefix);
  if (!normalized || !isValidShortCode(normalized, prefix)) return false;
  const body = normalized.slice(prefix.length);
  const checkSource = createHash('sha256').update(body.slice(0, 5)).digest('hex').slice(0, 4);
  return ALPHABET[Number(BigInt(`0x${checkSource}`) & 31n)] === body[5];
}
