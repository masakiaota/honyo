import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const mock = vi.hoisted(() => ({
  dir: '',
  available: true,
  encrypt: vi.fn((value: string) => Buffer.from(value).reverse()),
  decrypt: vi.fn((value: Buffer) => Buffer.from(value).reverse().toString()),
}));
vi.mock('electron', () => ({
  app: { getPath: (): string => mock.dir },
  safeStorage: {
    isEncryptionAvailable: (): boolean => mock.available,
    getSelectedStorageBackend: (): string => 'keyring',
    encryptString: mock.encrypt,
    decryptString: mock.decrypt,
  },
}));
import { loadSession, saveSession } from './storage.ts';
afterEach(() => {
  if (mock.dir) rmSync(mock.dir, { recursive: true, force: true });
  mock.available = true;
});
it('persists host and credentials through OS encryption with restrictive file permissions', () => {
  mock.dir = mkdtempSync(join(tmpdir(), 'honyo-session-test-'));
  const session = loadSession();
  session.accounts.push({
    id: 'account',
    clientId: 'client',
    label: 'Connection 1',
    credentials: {
      accessToken: 'private-access-token',
      refreshToken: 'refresh',
      idToken: 'identity',
      expiresAt: 1,
      scopes: [],
    },
  });
  saveSession(session);
  expect(readFileSync(join(mock.dir, 'chatgpt-session.enc'), 'utf8')).not.toContain(
    'private-access-token',
  );
  expect(mock.encrypt).toHaveBeenCalled();
  expect(loadSession()).toEqual(session);
  if (process.platform !== 'win32')
    expect(statSync(join(mock.dir, 'chatgpt-session.enc')).mode & 0o777).toBe(0o600);
  expect(readdirSync(mock.dir)).toEqual(['chatgpt-session.enc']);
});
it('does not write plaintext when OS encryption is unavailable', () => {
  mock.dir = mkdtempSync(join(tmpdir(), 'honyo-session-test-'));
  mock.available = false;
  expect(() => saveSession(loadSession())).toThrow('OS keychain');
  expect(readdirSync(mock.dir)).toEqual([]);
});
