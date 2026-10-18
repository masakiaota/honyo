import {
  CodexAppServer,
  type CodexAccount,
  type CodexNotification,
  type CodexTurnOptions,
} from './app-server.ts';
import { shouldRunCodexServer, toCodexModels } from './models.ts';
import { setCodexModels } from '../models-remote.ts';
import { getConfig } from '../config/index.ts';

export interface CodexConnectionState {
  status: 'disconnected' | 'connecting' | 'connected';
  account?: CodexAccount;
  error?: string;
}

const client = new CodexAppServer();
const listeners = new Set<(state: CodexConnectionState) => void>();
let state: CodexConnectionState = { status: 'disconnected' };
let initialized = false;
let initialization: Promise<void> | null = null;
let unsubscribe: (() => void) | null = null;
let settingsOpen = false;
let runtimeSync: Promise<void> = Promise.resolve();

function setCatalog(models: ReturnType<typeof toCodexModels>): void {
  setCodexModels(models);
}

function publish(next: CodexConnectionState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

async function refreshAccount(): Promise<void> {
  const account = await client.readAccount();
  if (!account || account.type !== 'chatgpt') {
    setCatalog({});
    publish({ status: 'disconnected' });
    return;
  }

  const models = await client.listModels();
  setCatalog(toCodexModels(models));
  publish({ status: 'connected', account });
}

function handleNotification(notification: CodexNotification): void {
  if (notification.method === 'account/updated') {
    void refreshAccount().catch(error => {
      setCatalog({});
      publish({ status: 'disconnected', error: errorMessage(error) });
    });
    return;
  }

  if (notification.method === 'account/login/completed') {
    void refreshAccount().catch(error => {
      setCatalog({});
      publish({ status: 'disconnected', error: errorMessage(error) });
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  if (!initialization) {
    initialization = client
      .start()
      .then(() => {
        unsubscribe ??= client.subscribe(handleNotification);
        initialized = true;
      })
      .catch(error => {
        initialization = null;
        throw error;
      });
  }
  return initialization;
}

export async function initializeCodex(): Promise<void> {
  try {
    await ensureInitialized();
    await refreshAccount();
  } catch (error) {
    setCatalog({});
    publish({ status: 'disconnected', error: errorMessage(error) });
  }
}

export function getCodexConnectionState(): CodexConnectionState {
  return state;
}

/**
 * Whether the Codex App Server must be running right now. See
 * `shouldRunCodexServer` for the policy definition.
 */
export function isCodexRequired(): boolean {
  return shouldRunCodexServer(getConfig().aiModel, settingsOpen);
}

async function applyCodexRuntime(): Promise<void> {
  if (!isCodexRequired()) {
    shutdownCodex();
    return;
  }
  await initializeCodex();
}

/**
 * Reconcile the App Server with the current requirement: start it when a Codex
 * model is selected or the model settings window is open, and stop it otherwise
 * so its memory is released. Calls are serialized, so rapid changes always
 * settle on the latest state.
 */
export function syncCodexRuntime(): Promise<void> {
  // Recover from a previous failure as well as from success, so a single bad
  // reconcile can never wedge every later one.
  runtimeSync = runtimeSync.then(applyCodexRuntime, applyCodexRuntime);
  return runtimeSync;
}

/** Feed the settings window's open/closed state into the runtime policy. */
export function setCodexSettingsOpen(open: boolean): void {
  settingsOpen = open;
  void syncCodexRuntime();
}

export function subscribeCodexConnection(
  listener: (state: CodexConnectionState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function startCodexLogin(): Promise<void> {
  await ensureInitialized();
  publish({ status: 'connecting' });
  try {
    await client.startChatgptLogin();
  } catch (error) {
    publish({ status: 'disconnected', error: errorMessage(error) });
    throw error;
  }
}

export async function logoutCodex(): Promise<void> {
  await ensureInitialized();
  await client.logout();
  setCatalog({});
  publish({ status: 'disconnected' });
}

export async function runCodexText(
  model: string,
  prompt: string,
  options: CodexTurnOptions | undefined,
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  await ensureInitialized();
  if (state.status !== 'connected') {
    await refreshAccount();
  }
  if (state.status !== 'connected') {
    throw new Error('ChatGPT/Codex account is not connected');
  }
  return client.runText(model, prompt, options, onDelta, signal);
}

export type { CodexTurnOptions };

export function shutdownCodex(): void {
  unsubscribe?.();
  unsubscribe = null;
  client.stop();
  initialized = false;
  initialization = null;
  setCatalog({});
  publish({ status: 'disconnected' });
}

client.onExit(() => {
  initialized = false;
  initialization = null;
  setCatalog({});
  publish({ status: 'disconnected', error: 'Codex App Server exited' });
});
