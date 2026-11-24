import * as crypto from 'crypto';
import { createOfflineAccount } from './auth';
import { store } from './store';
import type { Account, EmailCredential } from '../shared/types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new Error('Enter a valid email address');
  }
  return email;
}

/** Microsoft accounts are email-backed; Fox IDs are offline accounts with an email + password. */
export function hasPartyAccess(account: Account | null): boolean {
  return Boolean(account && (account.type === 'microsoft' || account.email));
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, credential: EmailCredential): boolean {
  const expected = Buffer.from(credential.hash, 'hex');
  const actual = Buffer.from(hashPassword(password, credential.salt), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/**
 * Creates a local party identity for a cracked/offline player. The password is
 * stored only as a salted scrypt verifier in the launcher data file; there is
 * no remote account service and no password is ever sent over the network.
 */
export async function signupEmail(name: string, emailInput: string, password: string): Promise<Account> {
  const cleanName = name.trim();
  if (!NAME_PATTERN.test(cleanName)) {
    throw new Error('Player name must be 3–16 letters, numbers, or underscores');
  }
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const email = normalizeEmail(emailInput);

  const data = store.get();
  if (data.accounts.some((account) => account.email?.toLowerCase() === email)) {
    throw new Error('That email already has a Fox ID. Log in instead.');
  }

  const existing = data.accounts.find((account) =>
    account.type === 'offline' && account.name.toLowerCase() === cleanName.toLowerCase());
  if (existing?.email) {
    throw new Error('That player name already has a Fox ID. Log in instead.');
  }

  const account: Account = existing
    ? { ...existing, name: existing.name, email, lastUsed: Date.now() }
    : { ...createOfflineAccount(cleanName), email };

  const salt = crypto.randomBytes(16).toString('hex');
  await store.setEmailCredential(account.id, { salt, hash: hashPassword(password, salt) });
  await store.upsertAccount(account);
  return account;
}

export async function loginEmail(emailInput: string, password: string): Promise<Account> {
  const email = normalizeEmail(emailInput);
  const account = store.get().accounts.find((item) => item.email?.toLowerCase() === email);
  if (!account) throw new Error('No Fox ID found for that email');
  const credential = store.getEmailCredential(account.id);
  if (!credential || !verifyPassword(password, credential)) {
    throw new Error('Incorrect email or password');
  }
  account.lastUsed = Date.now();
  await store.upsertAccount(account);
  return account;
}
