import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { translationInstruction } from './prompt.ts';
import { localDirection, validateLocalInput, validateLocalOutput } from './model.ts';
import type { LocalResult } from './model.ts';

const TIMEOUT_MS = 90_000;
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
  expiresAt: number;
  resolve: (response: string) => void;
  reject: (error: unknown) => void;
  promise: Promise<string>;
  cleanup: () => void;
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

function tokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Persistent native helper; all model work is serialized, with no idle unload or mid-stream retry. */
export class MlxEngine {
  private helper: Helper | undefined;
  private tail: Promise<void> = Promise.resolve();
  private stopping: Promise<void> = Promise.resolve();
  private generation = 0;
  private readonly operations = new Set<Operation>();

  private readonly modelPath: string;
  private readonly helperPath: string;
  private readonly template: 'hy18' | 'hy7' | undefined;

  constructor(modelPath: string, helperPath: string, template?: 'hy18' | 'hy7') {
    this.modelPath = modelPath;
    this.helperPath = helperPath;
    this.template = template;
  }

  warmup(target = 'Japanese', signal?: AbortSignal): Promise<void> {
    if (target !== 'Japanese' && target !== 'English')
      return Promise.reject(new Error('Offline translation supports English ↔ Japanese.'));
    return this.enqueue('warmup', target, undefined, signal).then(() => undefined);
  }

  translate(
    text: string,
    primary: string,
    secondary: string,
    signal?: AbortSignal,
    onChunk?: (text: string) => void,
  ): Promise<LocalResult> {
    validateLocalInput(text);
    if (this.template === 'hy18' && text.includes('\r'))
      throw new Error(
        'This 1.8B MLX checkpoint cannot preserve CR line endings. Select GGUF or supply LF-only text.',
      );
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
      expiresAt: performance.now() + TIMEOUT_MS,
      ...deferred,
      cleanup: () => undefined,
    };
    this.operations.add(operation);
    const cancel = (error: unknown): void => {
      if (operation.done) return;
      this.finish(operation, error);
      // Cancellation of a queued request must not kill another request's resident state.
      const helper = this.helper;
      if (helper?.pending === operation || (this.active === operation && helper))
        this.discard(helper, error);
    };
    const onAbort = (): void => cancel(signal?.reason);
    const timer = setTimeout(() => cancel(timeoutError()), TIMEOUT_MS);
    const finishedOrExpired = (): boolean => {
      if (!operation.done && performance.now() >= operation.expiresAt) cancel(timeoutError());
      return operation.done;
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    operation.cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      this.operations.delete(operation);
    };
    // Covers queueing, spawning, model load, prefill and generation with one deadline.
    const run = async (): Promise<void> => {
      if (finishedOrExpired()) return;
      if (generation !== this.generation) {
        this.finish(operation, releasedError());
        return;
      }
      this.active = operation;
      let helper: Helper | undefined;
      try {
        await this.stopping;
        if (finishedOrExpired()) return;
        helper = this.helper ?? this.start();
        await helper.ready;
        if (finishedOrExpired()) return;
        if (this.helper !== helper) throw new Error('MLX helper exited unexpectedly.');
        helper.pending = operation;
        const request = {
          id: operation.id,
          op,
          target,
          instruction: translationInstruction(target),
          ...(source === undefined ? {} : { text: source }),
        };
        helper.child.stdin.write(JSON.stringify(request) + '\n', error => {
          if (error && helper && this.helper === helper)
            this.discard(helper, new Error('Could not write to the MLX helper.'));
        });
        await operation.promise;
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
      if (frame.type !== 'ready' || frame.protocol !== 1 || frame.modelType !== 'hunyuan_v1_dense')
        throw protocolError();
      if (this.template && (frame.template !== this.template || frame.contextSize !== 4096))
        throw protocolError();
      helper.isReady = true;
      helper.resolveReady();
      return;
    }
    const operation = helper.pending;
    if (!operation || operation.done || operation.terminal || frame.id !== operation.id)
      throw protocolError();
    if (performance.now() >= operation.expiresAt) throw timeoutError();
    if (++operation.frames > MAX_FRAMES) throw protocolError();
    if (frame.type === 'error') {
      if (typeof frame.error !== 'string' || !frame.error.trim()) throw protocolError();
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
      // MLXLMCommon GenerateStopReason (mlx-swift-lm 3.32.3): stop, length, cancelled.
      if (frame.stopReason === 'length' || frame.outputTokens === frame.maxTokens)
        throw new Error('Translation reached its length limit. Please split the text and retry.');
      if (frame.stopReason !== 'stop' || frame.maxTokens === 0) throw protocolError();
      if (frame.echoedSource || frame.response.trim() === operation.source?.trim())
        throw new Error(
          'The offline model echoed the source instead of translating it. Please retry.',
        );
      if (operation.streamed && operation.streamed.trim() !== frame.response.trim())
        throw protocolError();
      validateLocalOutput(frame.response.trim(), operation.source);
    }
    const response = frame.response.trim();
    operation.terminal = true;
    // Process the rest of this stdout batch before resolving (duplicate/trailing frames are invalid).
    queueMicrotask(() => {
      if (this.helper !== helper || operation.done) return;
      helper.pending = undefined;
      this.finish(operation, undefined, response);
    });
  }

  private discard(helper: Helper, error: unknown): void {
    if (this.helper !== helper) return;
    this.helper = undefined;
    helper.rejectReady(error);
    if (helper.pending) this.finish(helper.pending, error);
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
