import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: fake.spawn }));
import { MlxEngine } from './mlx-engine.ts';
import { translationInstruction } from './prompt.ts';
import type { LocalResult } from './model.ts';

interface Request {
  id: string;
  op: 'warmup' | 'translate';
  target: string;
  instruction: string;
  text?: string;
}

const READY = { type: 'ready', protocol: 1, modelType: 'hunyuan_v1_dense' };

class Helper extends EventEmitter {
  pid: number | undefined = 123;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: Request[] = [];
  respond: ((request: Request) => void) | undefined;
  writeError: Error | undefined;
  readonly stdin = new Writable({
    write: (data: Buffer, _encoding, callback): void => {
      if (this.writeError) {
        callback(this.writeError);
        return;
      }
      const request = JSON.parse(data.toString()) as Request;
      this.requests.push(request);
      this.respond?.(request);
      callback();
    },
  });
  ignoresTerm = false;
  ignoresKill = false;
  readonly kill = vi.fn((signal: string) => {
    if ((signal === 'SIGTERM' && this.ignoresTerm) || this.ignoresKill) return true;
    queueMicrotask(() => this.emit('exit', null, signal));
    return true;
  });
  request(index = 0): Request {
    const request = this.requests[index];
    if (!request) throw new Error('No request was written');
    return request;
  }
  frame(frame: unknown): void {
    this.stdout.write(JSON.stringify(frame) + '\n');
  }
  result(request: Request, overrides: Record<string, unknown> = {}): void {
    this.frame({
      type: 'result',
      id: request.id,
      response:
        request.op === 'warmup' ? '' : request.target === 'Japanese' ? 'こんにちは' : 'Hello',
      stopReason: request.op === 'warmup' ? 'warmup' : 'stop',
      echoedSource: false,
      inputTokens: 64,
      maxTokens: request.op === 'warmup' ? 0 : 2048,
      outputTokens: request.op === 'warmup' ? 0 : 5,
      ...overrides,
    });
  }
}

let children: Helper[];
let engines: MlxEngine[];
function engine(template?: 'hy18' | 'hy7'): MlxEngine {
  const value = new MlxEngine('/model path', '/native helper', template);
  engines.push(value);
  return value;
}
function child(): Helper {
  const value = children.at(-1);
  if (!value) throw new Error('No helper was spawned');
  return value;
}
async function tick(): Promise<void> {
  for (let i = 0; i < 20; ++i) await Promise.resolve();
}
async function started(
  value: MlxEngine,
  signal?: AbortSignal,
  onChunk?: (text: string) => void,
): Promise<{ promise: Promise<LocalResult>; helper: Helper; request: Request }> {
  const promise = value.translate('Hello', 'Japanese', 'English', signal, onChunk);
  await tick();
  const helper = child();
  const request = helper.requests.at(-1);
  if (!request) throw new Error('No request was written');
  return { promise, helper, request };
}

beforeEach(() => {
  children = [];
  engines = [];
  vi.useFakeTimers();
  fake.spawn.mockReset().mockImplementation(() => {
    const helper = new Helper();
    children.push(helper);
    queueMicrotask(() => helper.frame(READY));
    return helper;
  });
});
afterEach(async () => {
  const released = engines.map(value => value.release().catch(() => undefined));
  await vi.advanceTimersByTimeAsync(2001);
  await Promise.all(released);
  vi.useRealTimers();
});

it('spawns the native helper directly and stays resident across warmup, translation and direction changes', async () => {
  const value = engine();
  const warm = value.warmup();
  await tick();
  const helper = child();
  const warmRequest = helper.request();
  expect(warmRequest).toEqual({
    id: warmRequest.id,
    op: 'warmup',
    target: 'Japanese',
    instruction: translationInstruction('Japanese'),
  });
  expect(warmRequest).not.toHaveProperty('text');
  helper.result(warmRequest);
  await warm;
  helper.respond = (request): void => helper.result(request);
  await expect(value.translate('Hello', 'Japanese', 'English')).resolves.toEqual({
    translation: 'こんにちは',
    sourceLanguage: 'English',
    targetLanguage: 'Japanese',
  });
  await expect(value.translate('こんにちは', 'Japanese', 'English')).resolves.toEqual({
    translation: 'Hello',
    sourceLanguage: 'Japanese',
    targetLanguage: 'English',
  });
  await value.warmup('English');
  expect(helper.requests.map(request => request.instruction)).toEqual([
    translationInstruction('Japanese'),
    translationInstruction('Japanese'),
    translationInstruction('English'),
    translationInstruction('English'),
  ]);
  expect(new Set(helper.requests.map(request => request.id)).size).toBe(4);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fake.spawn).toHaveBeenCalledExactlyOnceWith('/native helper', ['/model path'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  expect(helper.kill).not.toHaveBeenCalled();
});

it('serializes concurrent operations without leaking a previous source', async () => {
  const value = engine();
  const first = await started(value);
  const second = value.translate('Goodbye', 'English', 'Japanese');
  const warm = value.warmup('English');
  await tick();
  expect(first.helper.requests).toHaveLength(1);
  first.helper.result(first.request);
  await first.promise;
  await tick();
  expect(first.helper.requests).toHaveLength(2);
  expect(first.helper.requests[1]?.text).toBe('Goodbye');
  first.helper.result(first.helper.request(1));
  await second;
  await tick();
  expect(first.helper.requests[2]).not.toHaveProperty('text');
  first.helper.result(first.helper.request(2));
  await warm;
  expect(fake.spawn).toHaveBeenCalledOnce();
});

it('streams cumulative deltas and accepts trimmed results', async () => {
  const chunks = vi.fn();
  const { promise, helper, request } = await started(engine(), undefined, chunks);
  helper.frame({ type: 'chunk', id: request.id, text: ' こん' });
  helper.frame({ type: 'chunk', id: request.id, text: 'にちは ' });
  expect(chunks.mock.calls).toEqual([[' こん'], [' こんにちは ']]);
  helper.result(request);
  await expect(promise).resolves.toHaveProperty('translation', 'こんにちは');
});

it('parses split UTF-8 and batched JSONL frames', async () => {
  const chunks = vi.fn();
  const { promise, helper, request } = await started(engine(), undefined, chunks);
  const line = Buffer.from(
    JSON.stringify({ type: 'chunk', id: request.id, text: 'こんにちは' }) + '\n',
  );
  for (const byte of line) helper.stdout.write(Buffer.from([byte]));
  helper.result(request);
  await expect(promise).resolves.toHaveProperty('translation', 'こんにちは');
  expect(chunks).toHaveBeenCalledWith('こんにちは');
});

it('cancels active generation promptly, drops stale events, and restarts only on the next call', async () => {
  const value = engine();
  const controller = new AbortController();
  const chunks = vi.fn();
  const { promise, helper, request } = await started(value, controller.signal, chunks);
  const rejected = expect(promise).rejects.toThrow('Cancelled');
  helper.frame({ type: 'chunk', id: request.id, text: 'こん' });
  controller.abort(new Error('Cancelled'));
  expect(helper.kill).toHaveBeenCalledWith('SIGTERM');
  helper.frame({ type: 'chunk', id: request.id, text: 'late' });
  helper.result(request);
  await rejected;
  expect(chunks.mock.calls).toEqual([['こん']]);
  expect(fake.spawn).toHaveBeenCalledOnce();
  const next = await started(value);
  helper.emit('error', new Error('old child error'));
  helper.emit('exit', 1);
  next.helper.result(next.request);
  await expect(next.promise).resolves.toHaveProperty('translation', 'こんにちは');
  expect(fake.spawn).toHaveBeenCalledTimes(2);
});

it('does not spawn for pre-aborted, invalid input, direction, or warmup targets', async () => {
  const value = engine();
  const controller = new AbortController();
  controller.abort(new Error('Already cancelled'));
  await expect(value.translate('Hello', 'Japanese', 'English', controller.signal)).rejects.toThrow(
    'Already cancelled',
  );
  expect(() => value.translate('', 'Japanese', 'English')).toThrow('Enter text');
  expect(() => value.translate('x'.repeat(2001), 'Japanese', 'English')).toThrow('2,000');
  expect(() => value.translate('Hello', 'French', 'English')).toThrow('English ↔ Japanese');
  await expect(value.warmup('French')).rejects.toThrow('English ↔ Japanese');
  expect(fake.spawn).not.toHaveBeenCalled();
});

it('cancels queued work without killing the current request', async () => {
  const value = engine();
  const first = await started(value);
  const controller = new AbortController();
  const second = value.translate('Goodbye', 'Japanese', 'English', controller.signal);
  const rejected = expect(second).rejects.toThrow('Queued cancellation');
  controller.abort(new Error('Queued cancellation'));
  await rejected;
  expect(first.helper.kill).not.toHaveBeenCalled();
  first.helper.result(first.request);
  await first.promise;
  await tick();
  expect(first.helper.requests).toHaveLength(1);
});

it('release interrupts active and queued work, prevents old reloads and permits fresh use', async () => {
  const value = engine();
  const first = await started(value);
  const firstRejected = expect(first.promise).rejects.toThrow('released');
  const second = value.translate('Queued text', 'Japanese', 'English');
  const secondRejected = expect(second).rejects.toThrow('released');
  const released = value.release();
  expect(first.helper.kill).toHaveBeenCalledWith('SIGTERM');
  await Promise.all([released, firstRejected, secondRejected]);
  expect(first.helper.requests).toHaveLength(1);
  expect(fake.spawn).toHaveBeenCalledOnce();
  await value.release();
  const next = await started(value);
  next.helper.result(next.request);
  await next.promise;
  expect(fake.spawn).toHaveBeenCalledTimes(2);
});

it('release invalidates startup before ready and prevents queued warmup from spawning', async () => {
  const helper = new Helper();
  fake.spawn.mockReturnValue(helper);
  const value = engine();
  const first = value.warmup();
  const firstRejected = expect(first).rejects.toThrow('released');
  await tick();
  const queued = value.warmup();
  const queuedRejected = expect(queued).rejects.toThrow('released');
  await value.release();
  helper.frame(READY);
  await Promise.all([firstRejected, queuedRejected]);
  expect(helper.requests).toHaveLength(0);
  expect(fake.spawn).toHaveBeenCalledOnce();
});

it.each(['startup', 'generation', 'warmup'])(
  'uses one 90-second timeout for %s including loading',
  async phase => {
    const helper = new Helper();
    fake.spawn.mockReturnValueOnce(helper);
    const value = engine();
    const pending =
      phase === 'warmup' ? value.warmup() : value.translate('Hello', 'Japanese', 'English');
    const rejected = expect(pending).rejects.toThrow('timed out');
    await tick();
    await vi.advanceTimersByTimeAsync(60_000);
    if (phase !== 'startup') helper.frame(READY);
    await tick();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(helper.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(helper.kill).toHaveBeenCalledWith('SIGTERM');
    const next = await started(value);
    next.helper.result(next.request);
    await next.promise;
  },
);

it('escalates shutdown and blocks replacement until the old process exits', async () => {
  const value = engine();
  const controller = new AbortController();
  const current = await started(value, controller.signal);
  current.helper.ignoresTerm = true;
  const rejected = expect(current.promise).rejects.toThrow();
  controller.abort();
  await rejected;
  const nextPromise = value.translate('Next', 'Japanese', 'English');
  await tick();
  expect(fake.spawn).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  expect(current.helper.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
  await tick();
  const next = child();
  next.result(next.request());
  await nextPromise;
});

it('reports failure to kill rather than silently starting a second GPU process', async () => {
  const value = engine();
  const current = await started(value);
  current.helper.ignoresKill = true;
  const rejected = expect(current.promise).rejects.toThrow('released');
  const released = expect(value.release()).rejects.toThrow('did not exit');
  await vi.advanceTimersByTimeAsync(2000);
  await Promise.all([rejected, released]);
  await expect(value.warmup()).rejects.toThrow('did not exit');
  expect(fake.spawn).toHaveBeenCalledOnce();
  current.helper.emit('exit', null, 'SIGKILL');
});

it.each(['exit', 'close', 'error', 'stdout-end', 'stdin-error', 'stdout-error', 'stderr-error'])(
  'recovers from %s without retrying the active request',
  async event => {
    const value = engine();
    const current = await started(value);
    const rejected = expect(current.promise).rejects.toThrow();
    if (event === 'stdout-end') current.helper.stdout.end();
    else if (event === 'stdin-error')
      current.helper.stdin.emit('error', new Error('EPIPE source text'));
    else if (event === 'stdout-error')
      current.helper.stdout.emit('error', new Error('read failure'));
    else if (event === 'stderr-error')
      current.helper.stderr.emit('error', new Error('read failure'));
    else current.helper.emit(event, new Error('helper crashed'));
    await rejected;
    expect(fake.spawn).toHaveBeenCalledOnce();
    const next = await started(value);
    next.helper.result(next.request);
    await next.promise;
  },
);

it('handles synchronous spawn failure and later recovery', async () => {
  fake.spawn.mockImplementationOnce(() => {
    throw new Error('ENOENT');
  });
  const value = engine();
  await expect(value.warmup()).rejects.toThrow('ENOENT');
  const next = await started(value);
  next.helper.result(next.request);
  await next.promise;
});

it('handles asynchronous spawn errors without waiting for a nonexistent process', async () => {
  const helper = new Helper();
  helper.pid = undefined;
  fake.spawn.mockReturnValueOnce(helper);
  const value = engine();
  const pending = value.warmup();
  const rejected = expect(pending).rejects.toThrow('Could not start');
  await tick();
  helper.emit('error', new Error('ENOENT'));
  await rejected;
  await value.release();
  expect(helper.kill).not.toHaveBeenCalled();
});

it('rejects stdin EPIPE callbacks and emitted errors without leaking source text', async () => {
  const helper = new Helper();
  helper.writeError = new Error('EPIPE secret source');
  fake.spawn.mockReturnValueOnce(helper);
  const value = engine();
  const pending = value.translate('Hello', 'Japanese', 'English');
  const rejected = expect(pending).rejects.toThrow('MLX helper');
  await tick();
  helper.frame(READY);
  await rejected;
  expect(helper.kill).toHaveBeenCalledWith('SIGTERM');
});

it.each([
  {},
  { ...READY, protocol: 2 },
  { ...READY, protocol: '1' },
  { ...READY, modelType: 'llama' },
  { ...READY, protocol: undefined },
  { type: 'startup-error', error: 123 },
  { type: 'startup-error', error: '' },
  { type: 'chunk', id: 'unsolicited', text: 'secret' },
])('rejects malformed startup frame %j', async frame => {
  const helper = new Helper();
  fake.spawn.mockReturnValueOnce(helper);
  const pending = engine().warmup();
  const rejected = expect(pending).rejects.toThrow('protocol');
  await tick();
  helper.frame(frame);
  await rejected;
  expect(helper.kill).toHaveBeenCalledWith('SIGTERM');
});

it('redacts startup errors and bounded stderr rather than returning copied text', async () => {
  const helper = new Helper();
  fake.spawn.mockReturnValueOnce(helper);
  const pending = engine().warmup();
  const rejected = expect(pending).rejects.toThrow('could not load');
  await tick();
  helper.stderr.write('private copied text'.repeat(100_000));
  helper.frame({ type: 'startup-error', error: 'private copied text' });
  await rejected;
});

it.each([
  { type: 'ready', protocol: 1, modelType: 'hunyuan_v1_dense' },
  { type: 'chunk', text: 123 },
  { type: 'chunk', id: 'wrong', text: 'secret' },
  { type: 'error', error: 123 },
  { type: 'error', error: '' },
  { type: 'error', id: null, error: 'secret' },
  { type: 'unexpected' },
  null,
  [[]],
  'secret',
])('rejects malformed request frame %j and restarts', async frame => {
  const value = engine();
  const current = await started(value);
  const rejected = expect(current.promise).rejects.toThrow('protocol');
  current.helper.frame(
    frame && !Array.isArray(frame) && typeof frame === 'object'
      ? { id: current.request.id, ...frame }
      : frame,
  );
  await rejected;
  const next = await started(value);
  next.helper.result(next.request);
  await next.promise;
});

it.each([
  { response: null },
  { stopReason: null },
  { echoedSource: 'false' },
  { inputTokens: -1 },
  { inputTokens: 1.5 },
  { inputTokens: undefined },
  { maxTokens: '2048' },
  { maxTokens: 2049 },
  { inputTokens: 4096 },
  { inputTokens: 3600, maxTokens: 480 },
  { inputTokens: 3000, maxTokens: 2048 },
  { id: 'incorrect-result-id' },
  { id: undefined },
  { outputTokens: null },
  { outputTokens: 2049 },
  { stopReason: 'maxTokens' },
  { stopReason: 'cancelled' },
  { stopReason: 'unknown' },
])('rejects malformed result metadata %j', async overrides => {
  const current = await started(engine());
  const rejected = expect(current.promise).rejects.toThrow('protocol');
  current.helper.result(current.request, overrides);
  await rejected;
});

it.each([
  [{ stopReason: 'length' }, 'length limit'],
  [{ outputTokens: 2048 }, 'length limit'],
  [{ response: '' }, 'valid translation'],
  [{ response: 'Hello' }, 'echoed'],
  [{ echoedSource: true }, 'echoed'],
  [{ response: 'abcdefghijklmnop'.repeat(5) }, 'valid translation'],
])(
  'rejects invalid generated output %j and discards all process state',
  async (overrides, message) => {
    const value = engine();
    const current = await started(value);
    const rejected = expect(current.promise).rejects.toThrow(message);
    current.helper.result(current.request, overrides);
    await rejected;
    expect(current.helper.kill).toHaveBeenCalledWith('SIGTERM');
    const next = await started(value);
    next.helper.result(next.request);
    await next.promise;
  },
);

it('runs output preservation validators for code and URLs', async () => {
  const value = engine();
  const pending = value.translate('Use `foo()` at https://example.org', 'Japanese', 'English');
  const rejected = expect(pending).rejects.toThrow('preserve code or URLs');
  await tick();
  child().result(child().request());
  await rejected;
  const valid = value.translate('Use `foo()` at https://example.org', 'Japanese', 'English');
  await tick();
  child().result(child().request(), { response: '`foo()`をhttps://example.orgで使う' });
  await expect(valid).resolves.toHaveProperty('translation', '`foo()`をhttps://example.orgで使う');
});

it('rejects disagreement between streamed deltas and the final result', async () => {
  const current = await started(engine());
  const rejected = expect(current.promise).rejects.toThrow('protocol');
  current.helper.frame({ type: 'chunk', id: current.request.id, text: 'different' });
  current.helper.result(current.request);
  await rejected;
});

it('rejects duplicate terminal results before accepting a batched success', async () => {
  const current = await started(engine());
  const rejected = expect(current.promise).rejects.toThrow('protocol');
  current.helper.result(current.request);
  current.helper.result(current.request);
  await rejected;
});

it.each(['chunk', 'invalid-response', 'invalid-stop', 'echo', 'tokens', 'budget', 'context'])(
  'guards warmup %s results',
  async kind => {
    const pending = engine().warmup();
    const rejected = expect(pending).rejects.toThrow('protocol');
    await tick();
    const helper = child();
    const request = helper.request();
    if (kind === 'chunk') helper.frame({ type: 'chunk', id: request.id, text: '' });
    else
      helper.result(request, {
        ...(kind === 'invalid-response' ? { response: 'generated text' } : {}),
        ...(kind === 'invalid-stop' ? { stopReason: 'stop' } : {}),
        ...(kind === 'echo' ? { echoedSource: true } : {}),
        ...(kind === 'tokens' ? { outputTokens: 1, maxTokens: 1 } : {}),
        ...(kind === 'budget' ? { maxTokens: 1 } : {}),
        ...(kind === 'context' ? { inputTokens: 4096 } : {}),
      });
    await rejected;
  },
);

it.each([
  'bad-json',
  'invalid-utf8',
  'overlong-line',
  'overlong-chunk',
  'cumulative-output',
  'frame-flood',
  'byte-flood',
])('bounds and rejects %s', async kind => {
  const current = await started(engine());
  const rejected = expect(current.promise).rejects.toThrow('protocol');
  if (kind === 'bad-json') current.helper.stdout.write('{secret source\n');
  else if (kind === 'invalid-utf8') current.helper.stdout.write(Buffer.from([0xff, 10]));
  else if (kind === 'overlong-line') current.helper.stdout.write('x'.repeat(65537));
  else if (kind === 'overlong-chunk')
    current.helper.frame({ type: 'chunk', id: current.request.id, text: 'x'.repeat(65537) });
  else if (kind === 'cumulative-output') {
    for (let i = 0; i < 4; ++i)
      current.helper.frame({ type: 'chunk', id: current.request.id, text: 'x'.repeat(20000) });
  } else if (kind === 'frame-flood') {
    for (let i = 0; i < 8193; ++i)
      current.helper.frame({ type: 'chunk', id: current.request.id, text: '' });
  } else {
    for (let i = 0; i < 100; ++i) {
      current.helper.frame({
        type: 'chunk',
        id: current.request.id,
        text: '',
        extra: 'x'.repeat(20000),
      });
    }
  }
  await rejected;
});

it('redacts helper request errors', async () => {
  const current = await started(engine());
  const rejected = expect(current.promise).rejects.toThrow('could not complete');
  current.helper.frame({ type: 'error', id: current.request.id, error: 'secret copied source' });
  await rejected;
});

it('accepts the exact reduced output budget for a long prompt', async () => {
  const current = await started(engine());
  current.helper.result(current.request, { inputTokens: 3000, maxTokens: 1080 });
  await expect(current.promise).resolves.toHaveProperty('translation', 'こんにちは');
});

it('cancels startup promptly before the helper becomes ready', async () => {
  const helper = new Helper();
  fake.spawn.mockReturnValueOnce(helper);
  const controller = new AbortController();
  const value = engine();
  const pending = value.translate('Hello', 'Japanese', 'English', controller.signal);
  const rejected = expect(pending).rejects.toThrow('Startup cancelled');
  await tick();
  controller.abort(new Error('Startup cancelled'));
  expect(helper.kill).toHaveBeenCalledWith('SIGTERM');
  await rejected;
  helper.frame(READY);
  const next = await started(value);
  next.helper.result(next.request);
  await next.promise;
  expect(helper.requests).toHaveLength(0);
});

it('rejects an expired queued deadline without allowing it to reload after the active timeout', async () => {
  const value = engine();
  const current = await started(value);
  const firstRejected = expect(current.promise).rejects.toThrow('timed out');
  const queued = value.warmup();
  const queuedRejected = expect(queued).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(90_000);
  await Promise.all([firstRejected, queuedRejected]);
  expect(fake.spawn).toHaveBeenCalledOnce();
});

it('restarts after an idle helper crash or unsolicited frame without an idle unload', async () => {
  const value = engine();
  const current = await started(value);
  current.helper.result(current.request);
  await current.promise;
  current.helper.frame({ type: 'chunk', id: current.request.id, text: 'stale' });
  const next = await started(value);
  next.helper.result(next.request);
  await next.promise;
  next.helper.emit('exit', 1);
  const last = await started(value);
  last.helper.result(last.request);
  await last.promise;
  expect(fake.spawn).toHaveBeenCalledTimes(3);
});

it('does not forward late chunks when cancellation is triggered by the streaming callback', async () => {
  const value = engine();
  const controller = new AbortController();
  const chunks = vi.fn(() => controller.abort(new Error('Stream cancelled')));
  const current = await started(value, controller.signal, chunks);
  const rejected = expect(current.promise).rejects.toThrow('Stream cancelled');
  current.helper.frame({ type: 'chunk', id: current.request.id, text: 'こん' });
  current.helper.frame({ type: 'chunk', id: current.request.id, text: 'にちは' });
  await rejected;
  expect(chunks).toHaveBeenCalledExactlyOnceWith('こん');
});

it('allows fresh calls during release only after confirming the old helper exited', async () => {
  const value = engine();
  const current = await started(value);
  current.helper.ignoresTerm = true;
  const rejected = expect(current.promise).rejects.toThrow('released');
  const released = value.release();
  const fresh = value.translate('New request', 'Japanese', 'English');
  await tick();
  expect(fake.spawn).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  await Promise.all([released, rejected]);
  const next = child();
  next.result(next.request());
  await fresh;
  expect(fake.spawn).toHaveBeenCalledTimes(2);
});

it('discards state when a streaming consumer throws', async () => {
  const current = await started(engine(), undefined, () => {
    throw new Error('Consumer failure');
  });
  const rejected = expect(current.promise).rejects.toThrow('Consumer failure');
  current.helper.frame({ type: 'chunk', id: current.request.id, text: 'こん' });
  await rejected;
  expect(current.helper.kill).toHaveBeenCalledWith('SIGTERM');
});

it.each(['hy18', 'hy7'] as const)(
  'validates the ready template and fixed context for %s',
  async template => {
    fake.spawn.mockImplementation(() => {
      const helper = new Helper();
      children.push(helper);
      queueMicrotask(() => helper.frame({ ...READY, template, contextSize: 4096 }));
      return helper;
    });
    const value = engine(template);
    const warm = value.warmup();
    await tick();
    child().result(child().request());
    await warm;
  },
);

it.each([{ template: 'hy7', contextSize: 4096 }, { template: 'hy18', contextSize: 2048 }, {}])(
  'rejects incompatible ready metadata %j',
  async metadata => {
    fake.spawn.mockImplementation(() => {
      const helper = new Helper();
      children.push(helper);
      queueMicrotask(() => helper.frame({ ...READY, ...metadata }));
      return helper;
    });
    await expect(engine('hy18').warmup()).rejects.toThrow('protocol');
    expect(child().requests).toHaveLength(0);
  },
);

it('rejects CR for the pinned 1.8B checkpoint before spawning, without silently normalizing it', () => {
  expect(() => engine('hy18').translate('Before\r\nAfter', 'Japanese', 'English')).toThrow(
    'CR line endings',
  );
  expect(fake.spawn).not.toHaveBeenCalled();
});

it('cancels warmup before startup and accepts only supported target languages', async () => {
  const value = engine();
  const controller = new AbortController();
  controller.abort(new Error('Cancelled warmup'));
  await expect(value.warmup('Japanese', controller.signal)).rejects.toThrow('Cancelled warmup');
  await expect(value.warmup('French')).rejects.toThrow('English ↔ Japanese');
  expect(fake.spawn).not.toHaveBeenCalled();
});
