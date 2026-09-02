import {
  CodexAppServer,
  type CodexAccount,
  type CodexNotification,
  type CodexTurnOptions,
} from './app-server.ts';
import { DEFAULT_AI_MODEL } from '../models.ts';
import { getConfig, updateConfig } from '../config/index.ts';
import { getCodexModelId, toCodexModels } from './models.ts';
import { setCodexModels } from '../models-remote.ts';

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

function setCatalog(models: ReturnType<typeof toCodexModels>): void {
  setCodexModels(models);
  const selectedModel = getCodexModelId(getConfig().aiModel);
  if (selectedModel && !models[`codex:${selectedModel}`]) {
    updateConfig({ aiModel: DEFAULT_AI_MODEL });
  }
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
        client.subscribe(handleNotification);
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
  client.stop();
  initialized = false;
  initialization = null;
}

client.onExit(() => {
  initialized = false;
  initialization = null;
  setCatalog({});
  publish({ status: 'disconnected', error: 'Codex App Server exited' });
});
