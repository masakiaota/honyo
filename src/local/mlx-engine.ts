import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { localDirection, validateLocalInput, validateLocalOutput } from './model.ts';
import type { LocalResult } from './model.ts';

/** Inference deadline, counted from the moment the request reaches the loaded helper. */
const TIMEOUT_MS = 90_000;
/** Loading a large model (31B) from a cold disk cache can take minutes. */
const LOAD_TIMEOUT_MS = 5 * 60_000;
/** A cancelled request must be acknowledged this quickly, or the helper is replaced. */
const CANCEL_GRACE_MS = 5_000;
const PROTOCOL_VERSION = 2;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_PROTOCOL_BYTES = 1024 * 1024;
const MAX_FRAMES = 8192;
const MAX_STDERR_BYTES = 8 * 1024;

interface Operation {
  id: string;
  op: 'warmup' | 'translate';
  target: string;
  source: string | undefined;
  onChunk: ((text: string) => void) | undefined;
  streamed: string;
  outputBytes: number;
  frames: number;
  protocolBytes: number;
  done: boolean;
  terminal: boolean;
  resolve: (response: string) => void;
  reject: (error: unknown) => void;
  promise: Promise<string>;
  cleanup: () => void;
  grace: ReturnType<typeof setTimeout> | undefined;
  /** Resolves once the helper no longer works on this operation. */
  released: PromiseWithResolvers<void>;
}

interface Helper {
  child: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: unknown) => void;
  isReady: boolean;
  exited: boolean;
  exit: Promise<void>;
  resolveExit: () => void;
  line: Buffer;
  stderr: Buffer;
  startupBytes: number;
  pending: Operation | undefined;
  shutdown: Promise<void> | undefined;
}

function protocolError(): Error {
  // Never include raw frames, helper errors or stderr: any of these may contain copied text.
  return new Error('Invalid MLX helper protocol. Please retry the translation.');
}

function releasedError(): Error {
  return new Error('The offline model was released.');
}

function timeoutError(): Error {
  return new Error('Offline translation timed out after 90 seconds. Please retry.');
}

function loadTimeoutError(): Error {
  return new Error('Loading the offline model timed out. Please retry.');
}

function inputTooLongError(): Error {
  return new Error(
    'The text is too long for the offline model. Please shorten or split it and retry.',
  );
}

function tokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Persistent native helper; all model work is serialized, with no idle unload or mid-stream retry.
 * Cancelling a request keeps the loaded model: a queued or loading request is simply dropped,
 * and a running one is stopped by a cancel frame. The helper is replaced only on failures.
 */
export class MlxEngine {
  private helper: Helper | undefined;
  private tail: Promise<void> = Promise.resolve();
  private stopping: Promise<void> = Promise.resolve();
  private generation = 0;
  private readonly operations = new Set<Operation>();

  private readonly modelPath: string;
  private readonly helperPath: string;

  constructor(modelPath: string, helperPath: string) {
    this.modelPath = modelPath;
    this.helperPath = helperPath;
  }

  warmup(target = 'Japanese'): Promise<void> {
    if (target !== 'Japanese' && target !== 'English')
      return Promise.reject(new Error('Offline translation supports English ↔ Japanese.'));
    return this.enqueue('warmup', target).then(() => undefined);
  }

  translate(
    text: string,
    primary: string,
    secondary: string,
    signal?: AbortSignal,
    onChunk?: (text: string) => void,
  ): Promise<LocalResult> {
    validateLocalInput(text);
    const direction = localDirection(text, primary, secondary);
    return this.enqueue('translate', direction.targetLanguage, text, signal, onChunk).then(
      translation => ({ translation, ...direction }),
    );
  }

  release(): Promise<void> {
    // Invalidate queued calls immediately, rather than waiting behind a blocked GPU operation.
    ++this.generation;
    for (const operation of this.operations) this.finish(operation, releasedError());
    if (this.helper) this.discard(this.helper, releasedError());
    return Promise.all([this.tail, this.stopping]).then(() => undefined);
  }

  private enqueue(
    op: Operation['op'],
    target: string,
    source?: string,
    signal?: AbortSignal,
    onChunk?: (text: string) => void,
  ): Promise<string> {
    if (signal?.aborted)
      return Promise.reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error('Offline translation cancelled.'),
      );
    const generation = this.generation;
    const deferred = Promise.withResolvers<string>();
    const operation: Operation = {
      id: randomUUID(),
      op,
      target,
      source,
      onChunk,
      streamed: '',
      outputBytes: 0,
      frames: 0,
      protocolBytes: 0,
      done: false,
      terminal: false,
      ...deferred,
      cleanup: () => undefined,
      grace: undefined,
      released: Promise.withResolvers<void>(),
    };
    this.operations.add(operation);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = (error: unknown): void => {
      if (operation.done) return;
      this.finish(operation, error);
      // Queued and loading requests are dropped without touching the helper; the model
      // keeps loading for the next request. Only running work needs to be stopped.
      const helper = this.helper;
      if (helper?.pending === operation) this.requestCancel(helper, operation, error);
    };
    const onAbort = (): void => cancel(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    operation.cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      this.operations.delete(operation);
    };
    const run = async (): Promise<void> => {
      if (operation.done) return;
      if (generation !== this.generation) {
        this.finish(operation, releasedError());
        return;
      }
      this.active = operation;
      let helper: Helper | undefined;
      try {
        await this.stopping;
        if (operation.done) return;
        helper = this.helper ?? this.start();
        await helper.ready;
        if (operation.done) return;
        if (this.helper !== helper) throw new Error('MLX helper exited unexpectedly.');
        helper.pending = operation;
        timer = setTimeout(() => cancel(timeoutError()), TIMEOUT_MS);
        const request = {
          id: operation.id,
          op,
          target,
          ...(source === undefined ? {} : { text: source }),
        };
        helper.child.stdin.write(JSON.stringify(request) + '\n', error => {
          if (error && helper && this.helper === helper)
            this.discard(helper, new Error('Could not write to the MLX helper.'));
        });
        // Wait until the helper is free, not merely until the caller was answered.
        await operation.released.promise;
      } catch (error) {
        this.finish(operation, error);
        if (helper && this.helper === helper) this.discard(helper, error);
      } finally {
        this.active = undefined;
      }
    };
    this.tail = this.tail.then(run, run);
    return operation.promise;
  }

  private active: Operation | undefined;

  private requestCancel(helper: Helper, operation: Operation, error: unknown): void {
    // Called once: cancel() returns early for a finished operation.
    if (operation.terminal) return;
    helper.child.stdin.write(JSON.stringify({ id: operation.id, op: 'cancel' }) + '\n', failed => {
      if (failed && this.helper === helper)
        this.discard(helper, new Error('Could not write to the MLX helper.'));
    });
    operation.grace = setTimeout(() => {
      if (this.helper === helper && helper.pending === operation) this.discard(helper, error);
    }, CANCEL_GRACE_MS);
  }

  /** The helper finished this operation and is ready for the next one. */
  private releaseHelper(helper: Helper, operation: Operation): void {
    if (helper.pending === operation) helper.pending = undefined;
    clearTimeout(operation.grace);
    operation.released.resolve();
  }

  private finish(operation: Operation, error?: unknown, response = ''): void {
    if (operation.done) return;
    operation.done = true;
    operation.cleanup();
    if (error !== undefined) operation.reject(error);
    else operation.resolve(response);
  }

  private start(): Helper {
    // No shell, Python, extra arguments, or environment sourced from copied text.
    const child = spawn(this.helperPath, [this.modelPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    const ready = Promise.withResolvers<void>();
    const exit = Promise.withResolvers<void>();
    const helper: Helper = {
      child,
      ready: ready.promise,
      resolveReady: ready.resolve,
      rejectReady: ready.reject,
      isReady: false,
      exited: false,
      exit: exit.promise,
      resolveExit: exit.resolve,
      line: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      startupBytes: 0,
      pending: undefined,
      shutdown: undefined,
    };
    // Startup can fail between creation and the awaiting continuation.
    void helper.ready.catch(() => undefined);
    this.helper = helper;
    const loadTimer = setTimeout(() => {
      if (this.helper === helper && !helper.isReady) this.discard(helper, loadTimeoutError());
    }, LOAD_TIMEOUT_MS);
    void helper.ready.then(
      () => clearTimeout(loadTimer),
      () => clearTimeout(loadTimer),
    );
    child.stdout.on('data', (data: Buffer) => this.consume(helper, data));
    child.stderr.on('data', (data: Buffer) => {
      if (this.helper !== helper) return;
      helper.stderr = Buffer.concat([helper.stderr, data.subarray(-MAX_STDERR_BYTES)]).subarray(
        -MAX_STDERR_BYTES,
      );
    });
    const ioError = (): void => {
      if (this.helper === helper)
        this.discard(helper, new Error('MLX helper communication failed. Please retry.'));
    };
    child.stdin.on('error', ioError);
    child.stdout.on('error', ioError);
    child.stderr.on('error', ioError);
    child.stdout.on('end', () => {
      if (this.helper === helper)
        this.discard(helper, new Error('MLX helper output closed unexpectedly. Please retry.'));
    });
    child.on('error', () => {
      if (child.pid === undefined) {
        helper.exited = true;
        helper.resolveExit();
      }
      if (this.helper === helper)
        this.discard(
          helper,
          new Error('Could not start the native MLX helper. Please reinstall it.'),
        );
    });
    const onExit = (): void => {
      helper.exited = true;
      helper.resolveExit();
      if (this.helper === helper)
        this.discard(helper, new Error('MLX helper exited unexpectedly. Please retry.'));
    };
    child.once('exit', onExit);
    child.once('close', onExit);
    return helper;
  }

  private consume(helper: Helper, data: Buffer): void {
    if (this.helper !== helper) return;
    try {
      if (helper.pending) {
        helper.pending.protocolBytes += data.length;
        if (helper.pending.protocolBytes > MAX_PROTOCOL_BYTES) throw protocolError();
      } else if (!helper.isReady) {
        helper.startupBytes += data.length;
        if (helper.startupBytes > MAX_LINE_BYTES) throw protocolError();
      }
      let start = 0;
      while (start < data.length && this.helper === helper) {
        const newline = data.indexOf(10, start);
        const end = newline < 0 ? data.length : newline;
        const part = data.subarray(start, end);
        if (helper.line.length + part.length > MAX_LINE_BYTES) throw protocolError();
        helper.line = Buffer.concat([helper.line, part]);
        if (newline < 0) break;
        const line = new TextDecoder('utf-8', { fatal: true }).decode(helper.line);
        helper.line = Buffer.alloc(0);
        this.frame(helper, JSON.parse(line) as unknown);
        start = newline + 1;
      }
    } catch (error) {
      // Decoder/JSON errors also contain frame text on some Node versions; redact them.
      this.discard(
        helper,
        error instanceof SyntaxError || error instanceof TypeError ? protocolError() : error,
      );
    }
  }

  private frame(helper: Helper, value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw protocolError();
    const frame = value as Record<string, unknown>;
    if (!helper.isReady) {
      if (frame.type === 'startup-error' && typeof frame.error === 'string' && frame.error.trim())
        throw new Error('The native MLX helper could not load the offline model.');
      if (
        frame.type !== 'ready' ||
        frame.protocol !== PROTOCOL_VERSION ||
        frame.modelType !== 'plamo3' ||
        frame.decoder !== 'metal' ||
        frame.contextSize !== 4096
      )
        throw protocolError();
      helper.isReady = true;
      helper.resolveReady();
      return;
    }
    const operation = helper.pending;
    if (!operation || operation.terminal || frame.id !== operation.id) throw protocolError();
    if (++operation.frames > MAX_FRAMES) throw protocolError();
    if (operation.done) {
      // Cancelled: drop output until the helper reports that it stopped.
      if (frame.type === 'chunk') return;
      if (
        frame.type === 'cancelled' ||
        frame.type === 'result' ||
        (frame.type === 'error' && frame.code === 'input-too-long')
      ) {
        operation.terminal = true;
        this.releaseHelper(helper, operation);
        return;
      }
      throw protocolError();
    }
    if (frame.type === 'cancelled') throw protocolError();
    if (frame.type === 'error') {
      if (typeof frame.error !== 'string' || !frame.error.trim()) throw protocolError();
      if (frame.code === 'input-too-long') {
        // Rejected before any GPU work; the helper stays loaded.
        operation.terminal = true;
        this.releaseHelper(helper, operation);
        this.finish(operation, inputTooLongError());
        return;
      }
      throw new Error('The native MLX helper could not complete the request. Please retry.');
    }
    if (frame.type === 'chunk') {
      if (operation.op !== 'translate' || typeof frame.text !== 'string') throw protocolError();
      operation.outputBytes += Buffer.byteLength(frame.text);
      if (operation.outputBytes > MAX_OUTPUT_BYTES) throw protocolError();
      operation.streamed += frame.text;
      operation.onChunk?.(operation.streamed);
      return;
    }
    if (
      frame.type !== 'result' ||
      typeof frame.response !== 'string' ||
      typeof frame.stopReason !== 'string' ||
      typeof frame.echoedSource !== 'boolean' ||
      !tokenCount(frame.inputTokens) ||
      !tokenCount(frame.maxTokens) ||
      !tokenCount(frame.outputTokens) ||
      frame.outputTokens > frame.maxTokens ||
      Buffer.byteLength(frame.response) > MAX_OUTPUT_BYTES
    )
      throw protocolError();
    // A well-formed result that cannot be shown fails only this request; the helper is
    // already waiting for the next one, so keep the loaded model.
    let rejected: Error | undefined;
    if (operation.op === 'warmup') {
      if (
        frame.response !== '' ||
        frame.stopReason !== 'warmup' ||
        frame.echoedSource ||
        frame.maxTokens !== 0 ||
        frame.inputTokens > 4096 - 16 ||
        frame.outputTokens !== 0
      )
        throw protocolError();
    } else {
      // The production helper uses a fixed 4096-token context with a 16-token safety margin.
      if (
        frame.inputTokens > 4096 - 16 ||
        frame.maxTokens !== Math.min(2048, 4096 - frame.inputTokens - 16) ||
        frame.maxTokens < 512
      )
        throw protocolError();
      if (frame.stopReason === 'length' || frame.outputTokens === frame.maxTokens)
        rejected = new Error(
          'Translation reached its length limit. Please split the text and retry.',
        );
      else if (frame.stopReason !== 'stop' || frame.maxTokens === 0) throw protocolError();
      else if (operation.streamed && operation.streamed.trim() !== frame.response.trim())
        throw protocolError();
      else if (frame.echoedSource || frame.response.trim() === operation.source?.trim())
        rejected = new Error(
          'The offline model echoed the source instead of translating it. Please retry.',
        );
      else
        try {
          validateLocalOutput(frame.response.trim(), operation.source);
        } catch (error) {
          rejected = error instanceof Error ? error : protocolError();
        }
    }
    const response = frame.response.trim();
    operation.terminal = true;
    // Process the rest of this stdout batch before resolving (duplicate/trailing frames are invalid).
    queueMicrotask(() => {
      if (this.helper !== helper || helper.pending !== operation) return;
      this.releaseHelper(helper, operation);
      this.finish(operation, rejected, response);
    });
  }

  private discard(helper: Helper, error: unknown): void {
    if (this.helper !== helper) return;
    this.helper = undefined;
    helper.rejectReady(error);
    if (helper.pending) {
      this.finish(helper.pending, error);
      clearTimeout(helper.pending.grace);
      helper.pending.released.resolve();
    }
    // A failure during startup belongs to the active operation, too.
    if (this.active) this.finish(this.active, error);
    helper.pending = undefined;
    helper.line = Buffer.alloc(0);
    helper.stderr = Buffer.alloc(0);
    this.stopping = this.shutdown(helper);
    void this.stopping.catch(() => undefined);
  }

  private shutdown(helper: Helper): Promise<void> {
    if (helper.shutdown) return helper.shutdown;
    helper.shutdown = new Promise<void>((resolve, reject) => {
      let escalation: ReturnType<typeof setTimeout> | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const done = (): void => {
        clearTimeout(escalation);
        clearTimeout(deadline);
        escalation = undefined;
        deadline = undefined;
        helper.child.stdin.destroy();
        helper.child.stdout.destroy();
        helper.child.stderr.destroy();
        resolve();
      };
      if (helper.exited) {
        done();
        return;
      }
      void helper.exit.then(done);
      // Destroy the input first; helper may be waiting on readLine instead of GPU work.
      helper.child.stdin.destroy();
      helper.child.kill('SIGTERM');
      if (helper.exited) {
        done();
        return;
      }
      escalation = setTimeout(() => {
        if (!helper.exited) helper.child.kill('SIGKILL');
      }, 1000);
      deadline = setTimeout(() => {
        if (!helper.exited) reject(new Error('The native MLX helper did not exit after SIGKILL.'));
      }, 2000);
    });
    return helper.shutdown;
  }
}
