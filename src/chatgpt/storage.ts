import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const credentials = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  idToken: z.string(),
  expiresAt: z.number(),
  scopes: z.array(z.string()),
});
const account = z.object({
  id: z.string(),
  clientId: z.string(),
  label: z.string(),
  subject: z.string().optional(),
  email: z.string().optional(),
  credentials: credentials.optional(),
  pending: z
    .object({ credentials, receivedAt: z.number(), nonce: z.string().optional() })
    .optional(),
});
export const sessionSchema = z.object({
  version: z.literal(1),
  hostId: z.string(),
  selectedId: z.string().optional(),
  accounts: z.array(account),
});
export type Account = z.infer<typeof account>;
export type SessionData = z.infer<typeof sessionSchema>;

function path(): string {
  return join(app.getPath('userData'), 'chatgpt-session.enc');
}
function requireEncryption(): void {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  )
    throw new Error('An OS keychain is required to store ChatGPT credentials.');
}
export function loadSession(): SessionData {
  let encrypted: Buffer;
  try {
    encrypted = readFileSync(path());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 1, hostId: `urn:uuid:${randomUUID()}`, accounts: [] };
    throw new Error('Could not read the saved ChatGPT connection.');
  }
  requireEncryption();
  try {
    return sessionSchema.parse(JSON.parse(safeStorage.decryptString(encrypted)));
  } catch {
    throw new Error('Could not unlock the saved ChatGPT connection.');
  }
}
export function saveSession(data: SessionData): void {
  requireEncryption();
  const encrypted = safeStorage.encryptString(JSON.stringify(data));
  mkdirSync(app.getPath('userData'), { recursive: true });
  const temporary = `${path()}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path());
  } finally {
    rmSync(temporary, { force: true });
  }
}
