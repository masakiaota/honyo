import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import type { CodexModelDescriptor } from './models.ts';

const require = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
const DEFAULT_TIMEOUT_MS = 20_000;
const TRANSLATION_TIMEOUT_MS = 120_000;

type JsonObject = Record<string, unknown>;

export interface CodexAccount {
  type?: string;
  email?: string;
  planType?: string;
}

export interface CodexNotification {
  method: string;
  params: unknown;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function errorMessage(value: unknown, fallback: string): string {
  const error = asObject(value);
  return stringValue(error?.message) ?? fallback;
}

function codexEntrypoint(): string {
  const entrypoint = require.resolve('@openai/codex/bin/codex.js');
  if (!app.isPackaged) return entrypoint;

  const asarSegment = `${sep}app.asar${sep}`;
  return entrypoint.replace(asarSegment, `${sep}app.asar.unpacked${sep}`);
}

/** Minimal stdio client for the App Server operations Honyo needs. */
export class CodexAppServer {
  private process: ChildProcessWithoutNullStreams | null = null;
  private output: Interface | null = null;
  private initialized = false;
  private starting: Promise<void> | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private listeners = new Set<(notification: CodexNotification) => void>();
  private exitListeners = new Set<() => void>();

  async start(): Promise<void> {
    if (this.initialized) return;
    if (!this.starting) {
      this.starting = this.startInternal().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  subscribe(listener: (notification: CodexNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  async readAccount(): Promise<CodexAccount | null> {
    const result = asObject(await this.request('account/read', { refreshToken: false }));
    const account = asObject(result?.account);
    if (!account) return null;
    const type = stringValue(account.type);
    const email = stringValue(account.email);
    const planType = stringValue(account.planType);
    return {
      ...(type ? { type } : {}),
      ...(email ? { email } : {}),
      ...(planType ? { planType } : {}),
    };
  }

  async startChatgptLogin(): Promise<void> {
    const result = asObject(
      await this.request('account/login/start', {
        type: 'chatgpt',
        useHostedLoginSuccessPage: true,
        appBrand: 'chatgpt',
      }),
    );
    const authUrl = stringValue(result?.authUrl);
    if (!authUrl) throw new Error('ChatGPT login URL was not returned');

    let loginUrl: URL;
    try {
      loginUrl = new URL(authUrl);
    } catch {
      throw new Error('ChatGPT login URL is invalid');
    }
    if (loginUrl.protocol !== 'https:') {
      throw new Error('ChatGPT login URL must use HTTPS');
    }

    const { shell } = await import('electron');
    await shell.openExternal(loginUrl.toString());
  }

  async logout(): Promise<void> {
    await this.request('account/logout', {});
  }

  async listModels(): Promise<CodexModelDescriptor[]> {
    const models: CodexModelDescriptor[] = [];
    let cursor: string | null = null;

    do {
      const result = asObject(
        await this.request('model/list', {
          limit: 100,
          includeHidden: false,
          ...(cursor ? { cursor } : {}),
        }),
      );
      const data = result?.data;
      if (Array.isArray(data)) {
        for (const entry of data) {
          const item = asObject(entry);
          if (!item) continue;
          const id = stringValue(item.id);
          const model = stringValue(item.model);
          const displayName = stringValue(item.displayName);
          models.push({
            ...(id ? { id } : {}),
            ...(model ? { model } : {}),
            ...(displayName ? { displayName } : {}),
          });
        }
      }
      cursor = stringValue(result?.nextCursor) ?? null;
    } while (cursor);

    return models;
  }

  async runText(
    model: string,
    prompt: string,
    onDelta?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const threadResult = asObject(
      await this.request('thread/start', {
        model,
        cwd: app.getPath('temp'),
        approvalPolicy: 'never',
        sandbox: 'readOnly',
        serviceName: 'honyo',
      }),
    );
    const thread = asObject(threadResult?.thread);
    const threadId = stringValue(thread?.id);
    if (!threadId) throw new Error('Codex did not create a translation thread');

    let turnId: string | undefined;
    let text = '';
    let completed = false;
    let resolveCompletion: ((value: string) => void) | undefined;
    let rejectCompletion: ((reason: Error) => void) | undefined;
    const completion = new Promise<string>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });

    const unsubscribe = this.subscribe(notification => {
      const params = asObject(notification.params);
      const turn = asObject(params?.turn);
      const notificationThreadId = stringValue(params?.threadId) ?? stringValue(turn?.threadId);
      if (notificationThreadId !== threadId || completed) return;

      if (notification.method === 'item/agentMessage/delta') {
        const delta = stringValue(params?.delta);
        if (delta) {
          text += delta;
          onDelta?.(delta);
        }
        return;
      }

      if (notification.method === 'item/completed') {
        const item = asObject(params?.item);
        if (item?.type === 'agentMessage') {
          const finalText = stringValue(item.text);
          if (finalText) text = finalText;
        }
        return;
      }

      if (notification.method === 'turn/completed') {
        completed = true;
        if (turn?.status === 'completed') {
          resolveCompletion?.(text);
        } else {
          rejectCompletion?.(new Error(errorMessage(turn?.error, 'Codex translation failed')));
        }
      }
    });

    const abort = (): void => {
      if (completed) return;
      completed = true;
      if (turnId) {
        void this.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
      }
      rejectCompletion?.(new Error('Translation cancelled'));
    };
    signal?.addEventListener('abort', abort, { once: true });

    try {
      if (signal?.aborted) {
        abort();
        return await completion;
      }
      const turnResult = asObject(
        await this.request(
          'turn/start',
          {
            threadId,
            input: [{ type: 'text', text: prompt }],
            model,
            cwd: app.getPath('temp'),
            approvalPolicy: 'never',
            sandboxPolicy: {
              type: 'readOnly',
              access: {
                type: 'restricted',
                includePlatformDefaults: false,
                readableRoots: [],
              },
            },
          },
          TRANSLATION_TIMEOUT_MS,
        ),
      );
      turnId = stringValue(asObject(turnResult?.turn)?.id);
      return await completion;
    } finally {
      signal?.removeEventListener('abort', abort);
      unsubscribe();
      void this.request('thread/delete', { threadId }).catch(() => undefined);
    }
  }

  stop(): void {
    this.initialized = false;
    this.output?.close();
    this.output = null;
    this.process?.kill();
    this.process = null;
    this.rejectPending(new Error('Codex App Server stopped'));
  }

  private async startInternal(): Promise<void> {
    const codexHome = join(app.getPath('userData'), 'codex');
    mkdirSync(codexHome, { recursive: true });
    const environment = {
      ...process.env,
      CODEX_HOME: codexHome,
      ELECTRON_RUN_AS_NODE: '1',
    };
    const child = spawn(process.execPath, [codexEntrypoint(), 'app-server'], {
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    this.output = createInterface({ input: child.stdout });
    this.output.on('line', line => this.handleLine(line));
    child.stderr.on('data', (output: Buffer) =>
      console.error('Codex App Server:', output.toString()),
    );
    child.on('error', error => this.rejectPending(error));
    child.on('exit', () => {
      this.initialized = false;
      this.process = null;
      this.rejectPending(new Error('Codex App Server exited'));
      for (const listener of this.exitListeners) listener();
    });

    await this.request('initialize', {
      clientInfo: {
        name: 'honyo',
        title: 'Honyo',
        version: app.getVersion(),
      },
    });
    this.notify('initialized', {});
    this.initialized = true;
  }

  private request(
    method: string,
    params: JsonObject,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<unknown> {
    if (!this.process?.stdin.writable) {
      return Promise.reject(new Error('Codex App Server is not running'));
    }

    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.process?.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  private notify(method: string, params: JsonObject): void {
    this.process?.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonObject;
    try {
      const parsed: unknown = JSON.parse(line);
      const object = asObject(parsed);
      if (!object) return;
      message = object;
    } catch {
      console.error('Invalid Codex App Server response');
      return;
    }

    const method = stringValue(message.method);
    const id = message.id;
    if (typeof id === 'number' && method) {
      this.process?.stdin.write(
        `${JSON.stringify({
          id,
          error: { code: -32601, message: 'Honyo does not handle server requests' },
        })}\n`,
      );
      return;
    }

    if (typeof id === 'number') {
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      if (message.error) {
        pending.reject(new Error(errorMessage(message.error, 'Codex request failed')));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!method) return;
    for (const listener of this.listeners) listener({ method, params: message.params });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
