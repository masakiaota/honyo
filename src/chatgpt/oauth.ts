import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const SHARING_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${SHARING_SCOPE}`;
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  id_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
export type Tokens = z.infer<typeof tokenSchema>;
export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const newSecret = (): string => randomBytes(32).toString('base64url');
export const challenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

export function authorizationUrl(options: {
  hostId: string;
  clientId?: string;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
  idToken?: string;
  reconsent?: boolean;
}): string {
  const url = new URL(`${ISSUER}/api/accounts/authorize`);
  url.search = new URLSearchParams({
    client_id: options.clientId ?? 'dynamic_agent_client',
    ...(options.clientId ? {} : { agent_name_hint: 'Honyo' }),
    ext_agent_host_id: options.hostId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: SCOPES,
    resource: RESOURCE,
    state: options.state,
    nonce: options.nonce,
    code_challenge_method: 'S256',
    code_challenge: challenge(options.verifier),
    ...(options.idToken ? { id_token_hint: options.idToken } : {}),
    ...(options.reconsent ? { prompt: 'consent' } : {}),
  }).toString();
  return url.toString();
}

/** Listen only during sign-in; unmatched callbacks never consume the pending attempt. */
export async function listenForCode(
  state: string,
  signal: AbortSignal,
  clientId?: string,
): Promise<{
  redirectUri: string;
  result: Promise<{ code: string; clientId: string }>;
  close: () => void;
}> {
  signal.throwIfAborted();
  const pending = Promise.withResolvers<{ code: string; clientId: string }>();
  void pending.promise.catch(() => undefined);
  let accepted = false;
  let redirectUri = '';
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    let url: URL;
    try {
      url = new URL(req.url ?? '/', redirectUri);
    } catch {
      res.writeHead(400).end('Invalid request.');
      return;
    }
    if (
      req.method !== 'GET' ||
      req.headers.host !== new URL(redirectUri).host ||
      url.origin !== new URL(redirectUri).origin ||
      url.pathname !== '/auth/callback' ||
      accepted
    ) {
      res.writeHead(404).end('Not found');
      return;
    }
    const received = Buffer.from(url.searchParams.get('state') ?? '');
    const expected = Buffer.from(state);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      res.writeHead(400).end('Invalid sign-in attempt.');
      return;
    }
    accepted = true;
    if (url.searchParams.has('error')) {
      pending.reject(new AuthError('access_denied', 'ChatGPT sign-in was declined.'));
      res.writeHead(400).end('Sign-in was declined. Return to Honyo.');
      return;
    }
    const issuedId = url.searchParams.get('client_id') ?? clientId;
    const code = url.searchParams.get('code');
    if (
      !code ||
      code.length > 8192 ||
      !issuedId ||
      issuedId === 'dynamic_agent_client' ||
      !/^[\w.:-]{1,200}$/.test(issuedId) ||
      (clientId && issuedId !== clientId)
    ) {
      pending.reject(
        new AuthError('invalid_callback', 'ChatGPT returned an invalid registration.'),
      );
      res.writeHead(400).end('Sign-in could not be completed. Return to Honyo.');
      return;
    }
    pending.resolve({ code, clientId: issuedId });
    res.end('Authorization received. Return to Honyo to finish connecting.');
  });
  const cancel = (): void => {
    pending.reject(signal.reason);
    server.close();
    server.closeAllConnections();
  };
  signal.addEventListener('abort', cancel, { once: true });
  const close = (): void => {
    signal.removeEventListener('abort', cancel);
    server.close();
    server.closeAllConnections();
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    signal.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not start sign-in.');
    redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
    return { redirectUri, result: pending.promise, close };
  } catch (error) {
    close();
    throw error;
  }
}

export async function requestTokens(
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<Tokens> {
  const response = await fetch(`${ISSUER}/api/accounts/oauth/token`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, resource: RESOURCE }),
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const code = z.object({ error: z.string().regex(/^[a-z_]+$/) }).safeParse(data);
    throw new AuthError(
      code.success ? code.data.error : 'token_request_failed',
      `ChatGPT authorization failed (HTTP ${response.status}). Try connecting again.`,
    );
  }
  const parsed = tokenSchema.safeParse(data);
  if (!parsed.success)
    throw new AuthError('invalid_tokens', 'ChatGPT returned incomplete credentials.');
  return parsed.data;
}

const keys = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
export async function verifyIdentity(
  idToken: string,
  clientId: string,
  nonce?: string,
  receivedAt = Date.now(),
): Promise<{ subject: string; email?: string }> {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: ISSUER,
    audience: clientId,
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'exp', 'iat'],
    currentDate: new Date(receivedAt),
  });
  if ((nonce && payload.nonce !== nonce) || !payload.sub)
    throw new AuthError('invalid_identity', 'ChatGPT identity could not be verified.');
  return {
    subject: payload.sub,
    ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
  };
}

export async function revokeToken(clientId: string, refreshToken: string): Promise<void> {
  const discovery = await fetch(`${ISSUER}/.well-known/openid-configuration`, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const metadata = z.object({ revocation_endpoint: z.url() }).parse(await discovery.json());
  const url = new URL(metadata.revocation_endpoint);
  if (!discovery.ok || url.origin !== ISSUER) throw new Error('Invalid revocation endpoint.');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          token: refreshToken,
          token_type_hint: 'refresh_token',
        }),
      });
      if (response.ok) return;
      if (response.status < 500) break;
    } catch {
      /* One bounded retry while the refresh token is still available. */
    }
    if (attempt === 0) await delay(500);
  }
  throw new Error('Remote sign-out could not be confirmed.');
}
