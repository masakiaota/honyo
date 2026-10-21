import type * as OAuth from './oauth.ts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionData } from './storage.ts';
const mock = vi.hoisted(() => ({
  session: {} as SessionData,
  save: vi.fn(),
  tokens: vi.fn(),
  identity: vi.fn(),
  revoke: vi.fn(),
  models: vi.fn(),
  listen: vi.fn(),
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
  listenForCode: mock.listen,
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
  mock.listen.mockResolvedValue({
    redirectUri: 'http://127.0.0.1:1234/auth/callback',
    result: Promise.resolve({ code: 'code', clientId: 'issued' }),
    close: vi.fn(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ slug: 'test-model', display_name: 'Test', visibility: 'list' }],
      }),
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
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

it('preserves the selected account catalog when a previous account refresh fails', async () => {
  const { AuthError } = await import('./oauth.ts');
  const { withChatGPTToken, selectChatGPTAccount, getChatGPTState } = await import('./index.ts');
  const oldAccount = mock.session.accounts[0]!;
  mock.session.accounts.push({
    ...structuredClone(oldAccount),
    id: 'other',
    credentials: { ...oldAccount.credentials!, expiresAt: Date.now() + 3600_000 },
  });
  const refresh = Promise.withResolvers<never>();
  const started = Promise.withResolvers<void>();
  mock.tokens.mockImplementationOnce(() => {
    started.resolve();
    return refresh.promise;
  });
  const operation = vi.fn();
  const failed = expect(withChatGPTToken(operation)).rejects.toThrow('expired');
  await started.promise;
  await selectChatGPTAccount('other');
  const state = getChatGPTState();
  expect(mock.models).toHaveBeenLastCalledWith({
    'chatgpt:test-model': { provider: 'chatgpt', model: 'test-model', name: 'Test' },
  });
  mock.models.mockClear();
  refresh.reject(new AuthError('invalid_grant', 'expired'));
  await failed;
  expect(oldAccount.credentials).toBeUndefined();
  expect(getChatGPTState()).toEqual(state);
  expect(mock.models).not.toHaveBeenCalled();
  expect(operation).not.toHaveBeenCalled();
});

it.each(['exchange', 'identity'] as const)(
  'reuses the initial registration after a failed %s',
  async stage => {
    mock.session.accounts = [];
    delete mock.session.selectedId;
    const { signInChatGPT } = await import('./index.ts');
    (stage === 'exchange' ? mock.tokens : mock.identity).mockRejectedValueOnce(
      new Error('offline'),
    );
    await signInChatGPT();
    const account = mock.session.accounts[0]!;
    expect(account.clientId).toBe('issued');
    expect(mock.session.selectedId).toBe(account.id);
    expect(account.credentials).toBeUndefined();
    await signInChatGPT();
    expect(mock.listen).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(AbortSignal),
      'issued',
    );
    expect(mock.session.accounts).toHaveLength(1);
    expect(account.credentials?.accessToken).toBe('new-access');
  },
);

it('keeps the existing selection when adding an account fails', async () => {
  const { signInChatGPT } = await import('./index.ts');
  mock.tokens.mockRejectedValueOnce(new Error('offline'));
  await signInChatGPT(true);
  expect(mock.session.selectedId).toBe('account');
  expect(mock.session.accounts).toHaveLength(2);
});

it('blocks token acquisition throughout sign-out and resumes after signing in', async () => {
  const { withChatGPTToken, signOutChatGPT, signInChatGPT } = await import('./index.ts');
  const revocation = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  mock.revoke.mockImplementationOnce(() => {
    started.resolve();
    return revocation.promise;
  });
  const signingOut = signOutChatGPT();
  await started.promise;
  const operation = vi.fn();
  await expect(withChatGPTToken(operation)).rejects.toThrow();
  expect(mock.tokens).not.toHaveBeenCalled();
  expect(operation).not.toHaveBeenCalled();
  revocation.resolve();
  await signingOut;
  await expect(withChatGPTToken(operation)).rejects.toThrow();
  expect(mock.session.accounts[0]?.credentials).toBeUndefined();
  await signInChatGPT();
  expect(await withChatGPTToken(token => Promise.resolve(token))).toBe('new-access');
});
