import { shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { setChatGPTModels } from '../models-remote.ts';
import { loadSession, saveSession, type Account, type SessionData } from './storage.ts';
import {
  AuthError,
  SHARING_SCOPE,
  RESOURCE,
  newSecret,
  authorizationUrl,
  listenForCode,
  requestTokens,
  verifyIdentity,
  revokeToken,
  type Tokens,
} from './oauth.ts';
import { inferenceError } from '../openai/responses.ts';

export interface ChatGPTState {
  status: 'disconnected' | 'connecting' | 'connected';
  sharing: boolean;
  selectedId?: string;
  accounts: Array<{ id: string; label: string }>;
  error?: string;
}
let data: SessionData | undefined;
let errorMessage: string | undefined;
let login: AbortController | undefined;
let requests = new AbortController();
const refreshes = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const read = (): SessionData => (data ??= loadSession());
const selected = (): Account | undefined => read().accounts.find(a => a.id === read().selectedId);
const save = (): void => saveSession(read());
const publish = (): void => {
  for (const listener of listeners) listener();
};
const stopRequests = (): void => {
  requests.abort();
  requests = new AbortController();
};

export function getChatGPTState(): ChatGPTState {
  try {
    const account = selected();
    const selectedId = read().selectedId;
    return {
      status: login ? 'connecting' : account?.credentials ? 'connected' : 'disconnected',
      sharing: !!account?.credentials?.scopes.includes(SHARING_SCOPE),
      ...(selectedId ? { selectedId } : {}),
      accounts: read().accounts.map(a => ({
        id: a.id,
        label: a.email ? `${a.email} · ${a.label}` : a.label,
      })),
      ...(errorMessage ? { error: errorMessage } : {}),
    };
  } catch {
    return {
      status: 'disconnected',
      sharing: false,
      accounts: [],
      error: 'Could not unlock the saved ChatGPT connection.',
    };
  }
}
export function subscribeChatGPT(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Keep a rotated token encrypted before remote signature validation, so transient JWKS failures don't lose it. */
async function acceptTokens(
  account: Account,
  tokens: Tokens,
  nonce?: string,
  signal?: AbortSignal,
): Promise<void> {
  const now = Date.now();
  account.pending = {
    receivedAt: now,
    ...(nonce ? { nonce } : {}),
    credentials: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      expiresAt: now + tokens.expires_in * 1000,
      scopes: tokens.scope?.split(/\s+/) ?? (nonce ? [] : (account.credentials?.scopes ?? [])),
    },
  };
  save();
  await verifyPending(account, signal);
}
async function verifyPending(account: Account, signal?: AbortSignal): Promise<void> {
  if (!account.pending) return;
  const pending = account.pending;
  // Only the active sign-in may promote its tokens; background recovery is for refreshes.
  if (pending.nonce && !signal)
    throw new Error('Connect your ChatGPT account again in Model Settings.');
  signal?.throwIfAborted();
  const identity = await verifyIdentity(
    pending.credentials.idToken,
    account.clientId,
    pending.nonce,
    pending.receivedAt,
  );
  signal?.throwIfAborted();
  if (account.subject && account.subject !== identity.subject)
    throw new AuthError('identity_changed', 'The account did not match this saved connection.');
  account.subject = identity.subject;
  if (identity.email) account.email = identity.email;
  account.credentials = pending.credentials;
  delete account.pending;
  save();
}

async function accessToken(account: Account): Promise<string> {
  let refresh = refreshes.get(account.id);
  if (!refresh) {
    refresh = (async (): Promise<void> => {
      await verifyPending(account);
      const credentials = account.credentials;
      if (!credentials) throw new Error('Connect your ChatGPT account in Model Settings.');
      if (credentials.expiresAt > Date.now() + 60_000) return;
      try {
        const tokens = await requestTokens({
          grant_type: 'refresh_token',
          client_id: account.clientId,
          refresh_token: credentials.refreshToken,
        });
        await acceptTokens(account, tokens);
      } catch (error) {
        if (
          error instanceof AuthError &&
          /^(invalid_grant|invalid_refresh_token|token_expired|refresh_token_(expired|invalid|invalidated|reused))$/.test(
            error.code,
          )
        ) {
          delete account.credentials;
          delete account.pending;
          save();
          if (selected()?.id === account.id) {
            setChatGPTModels({});
            errorMessage = 'Your ChatGPT session has expired. Connect again in Model Settings.';
          }
          publish();
        }
        throw error;
      }
    })().finally(() => refreshes.delete(account.id));
    refreshes.set(account.id, refresh);
  }
  await refresh;
  const credentials = account.credentials;
  if (!credentials?.scopes.includes(SHARING_SCOPE))
    throw new Error('Enable ChatGPT plan usage by connecting again in Model Settings.');
  return credentials.accessToken;
}

export async function withChatGPTToken<T>(
  operation: (token: string, signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (login) throw new Error('Finish or cancel ChatGPT sign-in before translating.');
  const account = selected();
  if (!account) throw new Error('Connect your ChatGPT account in Model Settings.');
  const bounded = AbortSignal.any([requests.signal, ...(signal ? [signal] : [])]);
  bounded.throwIfAborted();
  let token: string;
  try {
    token = await accessToken(account);
  } catch (error) {
    if (error instanceof AuthError) throw new Error(error.message);
    throw new Error(
      'ChatGPT authorization could not be renewed. Check the connection or connect again.',
    );
  }
  bounded.throwIfAborted();
  return operation(token, bounded);
}

const catalogs = new Map<string, Promise<void>>();
export async function refreshChatGPTModels(): Promise<void> {
  const id = getChatGPTState().selectedId ?? '';
  const existing = catalogs.get(id);
  if (existing) return existing;
  const promise = loadModels(id).finally(() => catalogs.delete(id));
  catalogs.set(id, promise);
  return promise;
}
async function loadModels(accountId: string): Promise<void> {
  try {
    if (!getChatGPTState().sharing && !selected()?.pending) {
      setChatGPTModels({});
      return;
    }
    await withChatGPTToken(async (token, signal) => {
      const response = await fetch(`${RESOURCE}/models`, {
        headers: { authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      });
      if (!response.ok) throw inferenceError(undefined, response.status);
      const catalog = z
        .object({
          models: z.array(
            z.object({
              slug: z.string().min(1).max(200),
              display_name: z.string().min(1).max(200),
              visibility: z.string(),
            }),
          ),
        })
        .parse(await response.json());
      signal.throwIfAborted();
      setChatGPTModels(
        Object.fromEntries(
          catalog.models
            .filter(m => m.visibility === 'list')
            .map(m => [
              `chatgpt:${m.slug}`,
              { provider: 'chatgpt' as const, model: m.slug, name: m.display_name },
            ]),
        ),
      );
    });
    if (getChatGPTState().selectedId !== accountId) return;
    errorMessage = undefined;
  } catch {
    if (getChatGPTState().selectedId !== accountId) return;
    errorMessage =
      'Could not load ChatGPT models. Check the connection and refresh, or connect again.';
  }
  publish();
}

export async function signInChatGPT(newAccount = false): Promise<void> {
  if (login) throw new Error('ChatGPT sign-in is already in progress.');
  const controller = new AbortController();
  login = controller;
  errorMessage = undefined;
  publish();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5 * 60_000)]);
  let connected = false;
  let callback: Awaited<ReturnType<typeof listenForCode>> | undefined;
  try {
    let account = newAccount ? undefined : selected();
    if (account) await refreshes.get(account.id)?.catch(() => undefined);
    save(); // Persist the host identifier before opening the browser.
    const state = newSecret(),
      nonce = newSecret(),
      verifier = newSecret();
    callback = await listenForCode(state, signal, account?.clientId);
    await shell.openExternal(
      authorizationUrl({
        hostId: read().hostId,
        redirectUri: callback.redirectUri,
        state,
        nonce,
        verifier,
        ...(account ? { clientId: account.clientId } : {}),
        ...(account?.credentials ? { idToken: account.credentials.idToken } : {}),
        ...(account && !account.credentials?.scopes.includes(SHARING_SCOPE)
          ? { reconsent: true }
          : {}),
      }),
    );
    const result = await callback.result;
    signal.throwIfAborted();
    if (!account) {
      account = {
        id: randomUUID(),
        clientId: result.clientId,
        label: `Connection ${read().accounts.length + 1}`,
      };
      read().accounts.push(account);
      read().selectedId ??= account.id;
    }
    save(); // Retain the issued ID even if exchange fails; reconnect must reuse it.
    const tokens = await requestTokens(
      {
        grant_type: 'authorization_code',
        client_id: account.clientId,
        code: result.code,
        code_verifier: verifier,
        redirect_uri: callback.redirectUri,
      },
      signal,
    );
    await acceptTokens(account, tokens, nonce, signal);
    signal.throwIfAborted();
    stopRequests();
    read().selectedId = account.id;
    save();
    setChatGPTModels({});
    connected = true;
  } catch (error) {
    errorMessage = signal.aborted
      ? 'ChatGPT sign-in was cancelled or timed out.'
      : error instanceof AuthError
        ? error.message
        : 'ChatGPT sign-in could not be completed. Try connecting again.';
  } finally {
    callback?.close();
    login = undefined;
    publish();
  }
  if (connected) await refreshChatGPTModels();
}
export function cancelChatGPTSignIn(): void {
  login?.abort();
}
export async function selectChatGPTAccount(id: string): Promise<void> {
  if (login) throw new Error('Finish or cancel sign-in first.');
  if (!read().accounts.some(a => a.id === id)) throw new Error('Unknown ChatGPT connection.');
  stopRequests();
  read().selectedId = id;
  save();
  errorMessage = undefined;
  setChatGPTModels({});
  publish();
  await refreshChatGPTModels();
}
export async function signOutChatGPT(): Promise<void> {
  cancelChatGPTSignIn();
  requests.abort();
  const account = selected();
  if (!account) return;
  await refreshes.get(account.id)?.catch(() => undefined);
  const token = account.pending?.credentials.refreshToken ?? account.credentials?.refreshToken;
  errorMessage = undefined;
  if (token) {
    try {
      await revokeToken(account.clientId, token);
    } catch {
      errorMessage =
        'Signed out locally. Remote revocation was not confirmed; disconnect Honyo in ChatGPT settings.';
    }
  }
  delete account.credentials;
  delete account.pending;
  save();
  setChatGPTModels({});
  publish();
}
export function shutdownChatGPT(): void {
  login?.abort();
  requests.abort();
}
