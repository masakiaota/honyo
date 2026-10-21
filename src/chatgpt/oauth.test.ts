import type * as Jose from 'jose';
import { afterEach, expect, it, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
const mock = vi.hoisted(() => ({
  keys: undefined as ReturnType<typeof createLocalJWKSet> | undefined,
}));
vi.mock('jose', async original => ({
  ...(await original<typeof Jose>()),
  createRemoteJWKSet:
    (): ReturnType<typeof createLocalJWKSet> =>
    (...args) => {
      if (!mock.keys) throw new Error('Missing test keys');
      return mock.keys(...args);
    },
}));
import {
  authorizationUrl,
  listenForCode,
  requestTokens,
  verifyIdentity,
  ISSUER,
  RESOURCE,
} from './oauth.ts';
afterEach(() => vi.unstubAllGlobals());

it('uses dynamic registration only for the first authorization and retains PKCE and full scope on reconnect', () => {
  const options = {
    hostId: 'urn:uuid:test',
    redirectUri: 'http://127.0.0.1:1234/auth/callback',
    state: 'state',
    nonce: 'nonce',
    verifier: 'verifier',
  };
  const first = new URL(authorizationUrl(options));
  expect(first.searchParams.get('client_id')).toBe('dynamic_agent_client');
  expect(first.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
  expect(first.searchParams.get('code_challenge_method')).toBe('S256');
  const reconnect = new URL(authorizationUrl({ ...options, clientId: 'issued', reconsent: true }));
  expect(reconnect.searchParams.get('client_id')).toBe('issued');
  expect(reconnect.searchParams.has('agent_name_hint')).toBe(false);
  expect(reconnect.searchParams.get('prompt')).toBe('consent');
});
it('rejects mismatched state without consuming the callback', async () => {
  const callback = await listenForCode('expected', new AbortController().signal);
  try {
    expect(
      (await fetch(`${callback.redirectUri}?state=wrong&code=a&client_id=issued`)).status,
    ).toBe(400);
    expect(
      (await fetch(`${callback.redirectUri}?state=expected&code=a&client_id=issued`)).status,
    ).toBe(200);
    expect(await callback.result).toEqual({ code: 'a', clientId: 'issued' });
  } finally {
    callback.close();
  }
});
it('rejects a changed registration on reconnect', async () => {
  const callback = await listenForCode('state', new AbortController().signal, 'saved');
  try {
    await fetch(`${callback.redirectUri}?state=state&code=a&client_id=different`);
    await expect(callback.result).rejects.toThrow('invalid registration');
  } finally {
    callback.close();
  }
});
it('closes the callback when sign-in is cancelled', async () => {
  const controller = new AbortController();
  const callback = await listenForCode('state', controller.signal);
  controller.abort();
  await expect(callback.result).rejects.toMatchObject({ name: 'AbortError' });
  await expect(fetch(callback.redirectUri)).rejects.toThrow();
  callback.close();
});
it('exchanges at the public token endpoint without a secret and sanitizes errors', async () => {
  const fetch = vi.fn((_url: unknown, init: RequestInit): Promise<Response> => {
    expect(_url).toBe(`${ISSUER}/api/accounts/oauth/token`);
    expect(new URLSearchParams(init.body as URLSearchParams).get('resource')).toBe(RESOURCE);
    return Promise.resolve(
      new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'secret details' }),
        { status: 400 },
      ),
    );
  });
  vi.stubGlobal('fetch', fetch);
  await expect(
    requestTokens({ client_id: 'issued', grant_type: 'refresh_token', refresh_token: 'private' }),
  ).rejects.toMatchObject({
    code: 'invalid_grant',
  });
});
it('checks signed identity, audience, issuer, nonce and expiry', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  mock.keys = createLocalJWKSet({ keys: [await exportJWK(publicKey)] });
  const sign = (audience = 'issued', issuer = ISSUER, expiry = '1h'): Promise<string> =>
    new SignJWT({ nonce: 'nonce', email: 'user@example.test' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('subject')
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiry)
      .sign(privateKey);
  expect(await verifyIdentity(await sign(), 'issued', 'nonce')).toEqual({
    subject: 'subject',
    email: 'user@example.test',
  });
  await expect(verifyIdentity(await sign('other'), 'issued', 'nonce')).rejects.toThrow();
  await expect(
    verifyIdentity(await sign('issued', 'https://wrong.test'), 'issued', 'nonce'),
  ).rejects.toThrow();
  await expect(verifyIdentity(await sign(), 'issued', 'wrong')).rejects.toThrow();
  await expect(
    verifyIdentity(await sign('issued', ISSUER, '-1h'), 'issued', 'nonce'),
  ).rejects.toThrow();
});
