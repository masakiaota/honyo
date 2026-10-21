import type * as OAuth from './oauth.ts';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SessionData } from './storage.ts';
const mock = vi.hoisted(() => ({
  session: {} as SessionData,
  save: vi.fn(),
  tokens: vi.fn(),
  identity: vi.fn(),
  revoke: vi.fn(),
  models: vi.fn(),
}));
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }));
vi.mock('../models-remote.ts', () => ({ setChatGPTModels: mock.models }));
vi.mock('./storage.ts', () => ({
  loadSession: (): SessionData => mock.session,
  saveSession: mock.save,
}));
vi.mock('./oauth.ts', async original => ({
  ...(await original<typeof OAuth>()),
  requestTokens: mock.tokens,
  verifyIdentity: mock.identity,
  revokeToken: mock.revoke,
}));
const scopes = ['chatgpt.tokens.use.direct'];
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mock.session = {
    version: 1,
    hostId: 'urn:uuid:host',
    selectedId: 'account',
    accounts: [
      {
        id: 'account',
        clientId: 'issued',
        label: 'Connection 1',
        subject: 'subject',
        credentials: {
          accessToken: 'old-access',
          refreshToken: 'old-refresh',
          idToken: 'old-id',
          expiresAt: 0,
          scopes,
        },
      },
    ],
  };
  mock.tokens.mockResolvedValue({
    access_token: 'new-access',
    refresh_token: 'rotated-refresh',
    id_token: 'new-id',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: scopes.join(' '),
  });
  mock.identity.mockResolvedValue({ subject: 'subject' });
  mock.revoke.mockResolvedValue(undefined);
});
it('serializes concurrent refreshes and saves rotated tokens before validating identity', async () => {
  const { withChatGPTToken } = await import('./index.ts');
  const saved: unknown[] = [];
  mock.save.mockImplementation(data => saved.push(structuredClone(data)));
  const result = await Promise.all([
    withChatGPTToken(token => Promise.resolve(token)),
    withChatGPTToken(token => Promise.resolve(token)),
  ]);
  expect(result).toEqual(['new-access', 'new-access']);
  expect(mock.tokens).toHaveBeenCalledOnce();
  expect(mock.tokens).toHaveBeenCalledWith({
    grant_type: 'refresh_token',
    client_id: 'issued',
    refresh_token: 'old-refresh',
  });
  expect(saved[0]).toMatchObject({
    accounts: [{ pending: { credentials: { refreshToken: 'rotated-refresh' } } }],
  });
  expect(mock.session.accounts[0]?.credentials?.refreshToken).toBe('rotated-refresh');
  const { getChatGPTState } = await import('./index.ts');
  expect(JSON.stringify(getChatGPTState())).not.toMatch(
    /old-access|new-access|refresh|new-id|issued/,
  );
});
it('retains the rotated refresh token after a temporary identity verification failure', async () => {
  const { withChatGPTToken } = await import('./index.ts');
  mock.identity.mockRejectedValueOnce(new Error('temporary JWKS outage'));
  await expect(withChatGPTToken(token => Promise.resolve(token))).rejects.toThrow(
    'could not be renewed',
  );
  expect(mock.session.accounts[0]?.pending?.credentials.refreshToken).toBe('rotated-refresh');
  expect(await withChatGPTToken(token => Promise.resolve(token))).toBe('new-access');
  expect(mock.tokens).toHaveBeenCalledOnce();
});
it('preserves credentials on a transient refresh failure', async () => {
  const { withChatGPTToken } = await import('./index.ts');
  mock.tokens.mockRejectedValueOnce(new Error('network unavailable'));
  await expect(withChatGPTToken(token => Promise.resolve(token))).rejects.toThrow();
  expect(mock.session.accounts[0]?.credentials?.refreshToken).toBe('old-refresh');
});
it('clears unusable credentials but retains registration and host on terminal refresh failure', async () => {
  const { AuthError } = await import('./oauth.ts');
  mock.tokens.mockRejectedValue(new AuthError('invalid_grant', 'expired'));
  const { withChatGPTToken } = await import('./index.ts');
  await expect(withChatGPTToken(token => Promise.resolve(token))).rejects.toThrow();
  expect(mock.session.accounts[0]?.credentials).toBeUndefined();
  expect(mock.session.accounts[0]?.clientId).toBe('issued');
  expect(mock.session.hostId).toBe('urn:uuid:host');
});
it('does not infer plan consent from a signed identity', async () => {
  mock.tokens.mockResolvedValue({
    access_token: 'identity-only',
    refresh_token: 'refresh',
    id_token: 'id',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'openid profile',
  });
  const { withChatGPTToken } = await import('./index.ts');
  const inference = vi.fn();
  await expect(withChatGPTToken(inference)).rejects.toThrow();
  expect(inference).not.toHaveBeenCalled();
});
it('stops requests and clears local credentials even if remote sign-out fails', async () => {
  const { withChatGPTToken, signOutChatGPT, getChatGPTState } = await import('./index.ts');
  let signal: AbortSignal | undefined;
  await withChatGPTToken((_token, value) => {
    signal = value;
    return Promise.resolve();
  });
  mock.revoke.mockRejectedValue(new Error('network failure'));
  await signOutChatGPT();
  expect(signal?.aborted).toBe(true);
  expect(mock.revoke).toHaveBeenCalledWith('issued', 'rotated-refresh');
  expect(mock.session.accounts[0]?.credentials).toBeUndefined();
  expect(getChatGPTState().error).toContain('Remote revocation was not confirmed');
});
