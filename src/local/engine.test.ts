import { afterEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
  generate: vi.fn(),
  text: vi.fn(),
  contextDispose: vi.fn(),
  completionDispose: vi.fn(),
  completion: vi.fn(),
  adapt: vi.fn(),
  sequence: vi.fn(),
  prefill: vi.fn(),
  modelDispose: vi.fn(),
  load: vi.fn(),
  create: vi.fn(),
}));
vi.mock('node-llama-cpp', () => {
  fake.create.mockResolvedValue({
    contextSize: 4096,
    getSequence: fake.sequence.mockReturnValue({
      adaptStateToTokens: fake.adapt,
      evaluateWithoutGeneratingNewTokens: fake.prefill,
      nextTokenIndex: 0,
    }),
    dispose: fake.contextDispose,
  });
  fake.load.mockResolvedValue({
    createContext: fake.create,
    dispose: fake.modelDispose,
    tokenizer: vi.fn(),
  });
  return {
    getLlama: vi.fn().mockResolvedValue({ loadModel: fake.load }),
    LlamaCompletion: class {
      constructor(options: unknown) {
        fake.completion(options);
      }
      generateCompletionWithMeta = fake.generate;
      dispose = fake.completionDispose;
    },
    LlamaText: fake.text.mockImplementation(
      (...parts: unknown[]): { tokenize: () => number[] } => ({
        tokenize: (): number[] => (parts.length === 2 ? [1, 2] : [1, 2, 3]),
      }),
    ),
    SpecialTokensText: class {
      constructor(readonly value: string) {}
    },
  };
});
import { LocalEngine } from './engine.ts';
import { LOCAL_MODEL_ID, LOCAL_7B_MODEL_ID, getLocalModel } from './model.ts';
afterEach(() => {
  vi.clearAllMocks();
  fake.generate.mockReset();
  fake.adapt.mockReset();
  fake.prefill.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('reuses one context and sequence, retaining only instructions after each request', async () => {
  const engine = new LocalEngine('/model.gguf');
  fake.generate.mockResolvedValue({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } });
  await engine.warmup();
  await engine.translate('Hello', 'Japanese', 'English');
  await engine.translate('Good morning', 'Japanese', 'English');
  expect(fake.load).toHaveBeenCalledOnce();
  expect(fake.create).toHaveBeenCalledOnce();
  expect(fake.sequence).toHaveBeenCalledOnce();
  expect(fake.completion.mock.calls[0]).toEqual(fake.completion.mock.calls[1]);
  expect(fake.adapt.mock.calls).toEqual([
    [[1, 2], false],
    [[1, 2], false],
    [[1, 2], false],
  ]);
  expect(fake.completionDispose).toHaveBeenCalledTimes(2);
  expect(fake.completionDispose).toHaveBeenCalledWith({ disposeSequence: false });
  expect(fake.contextDispose).not.toHaveBeenCalled();
  expect(fake.modelDispose).not.toHaveBeenCalled();
  await engine.release();
  await engine.release();
  expect(fake.contextDispose).toHaveBeenCalledOnce();
  expect(fake.modelDispose).toHaveBeenCalledOnce();
  expect(fake.contextDispose).toHaveBeenCalledBefore(fake.modelDispose);
  await engine.translate('Hello', 'Japanese', 'English');
  expect(fake.load).toHaveBeenCalledTimes(2);
  expect(fake.create).toHaveBeenCalledTimes(2);
});
it.each([LOCAL_MODEL_ID, LOCAL_7B_MODEL_ID])(
  'prefills only the common instruction for %s and preserves it for the first request',
  async id => {
    const engine = new LocalEngine('/model.gguf', getLocalModel(id));
    await engine.warmup('English');
    expect(fake.prefill).toHaveBeenCalledWith([1, 2]);
    expect(fake.completion).not.toHaveBeenCalled();
    expect(fake.generate).not.toHaveBeenCalled();
    expect(fake.text.mock.calls[0]?.[1]).toMatch(
      /^Translate the following text into English\..*\n$/,
    );
    const warmedPrefix = fake.text.mock.calls[0];
    fake.generate.mockResolvedValueOnce({
      response: 'Hello',
      metadata: { stopReason: 'eogToken' },
    });
    await engine.translate('こんにちは', 'English', 'Japanese');
    const request = fake.text.mock.calls.find(parts => parts.length === 3);
    expect(request?.[0]).toEqual(warmedPrefix?.[0]);
    expect(request?.[1]).toBe(String(warmedPrefix?.[1]) + 'こんにちは');
    expect(fake.create).toHaveBeenCalledOnce();
    await engine.release();
  },
);

it('discards a failed prefill, retries with the same weights and waits for prefill before release', async () => {
  const engine = new LocalEngine('/model.gguf');
  fake.prefill.mockRejectedValueOnce(new Error('Prefill failed'));
  await expect(engine.warmup()).rejects.toThrow('Prefill failed');
  expect(fake.contextDispose).toHaveBeenCalledOnce();
  const pending = Promise.withResolvers<void>();
  fake.prefill.mockReturnValueOnce(pending.promise);
  const warmed = engine.warmup();
  await vi.waitFor(() => expect(fake.prefill).toHaveBeenCalledTimes(2));
  const cancelled = expect(warmed).rejects.toThrow('released');
  const released = engine.release();
  expect(fake.modelDispose).not.toHaveBeenCalled();
  pending.resolve();
  await Promise.all([cancelled, released]);
  expect(fake.load).toHaveBeenCalledOnce();
  expect(fake.create).toHaveBeenCalledTimes(2);
  expect(fake.contextDispose).toHaveBeenCalledTimes(2);
  expect(fake.modelDispose).toHaveBeenCalledOnce();
});
it.each([
  ['truncated', '途中', 'maxTokens', 'length limit'],
  ['invalid', '', 'eogToken', 'valid translation'],
])(
  'discards a %s result and recreates the context for a retry',
  async (_, response, stopReason, error) => {
    const engine = new LocalEngine('/model.gguf');
    fake.generate.mockResolvedValueOnce({ response, metadata: { stopReason } });
    await expect(engine.translate('Hello', 'Japanese', 'English')).rejects.toThrow(error);
    expect(fake.contextDispose).toHaveBeenCalledOnce();
    expect(fake.adapt).not.toHaveBeenCalled();
    fake.generate.mockResolvedValueOnce({
      response: 'こんにちは',
      metadata: { stopReason: 'eogToken' },
    });
    await expect(engine.translate('Hello', 'Japanese', 'English')).resolves.toHaveProperty(
      'translation',
      'こんにちは',
    );
    expect(fake.create).toHaveBeenCalledTimes(2);
    expect(fake.sequence).toHaveBeenCalledTimes(2);
    expect(fake.load).toHaveBeenCalledOnce();
  },
);
it('does not start GPU work for an already cancelled request', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    new LocalEngine('/model.gguf').translate('Hello', 'Japanese', 'English', controller.signal),
  ).rejects.toThrow();
  expect(fake.load).not.toHaveBeenCalled();
});
it('cancels active and queued requests but drains generation before releasing shared state', async () => {
  const engine = new LocalEngine('/model.gguf');
  const pending = Promise.withResolvers<{ response: string; metadata: { stopReason: string } }>();
  fake.generate
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } });
  const first = engine.translate('Hello', 'Japanese', 'English');
  await vi.waitFor(() => expect(fake.generate).toHaveBeenCalledOnce());
  const second = engine.translate('Hello again', 'Japanese', 'English');
  const cancellations = [
    expect(first).rejects.toThrow('released'),
    expect(second).rejects.toThrow('released'),
  ];
  const released = engine.release();
  expect(fake.create).toHaveBeenCalledOnce();
  expect(fake.generate).toHaveBeenCalledOnce();
  expect(fake.contextDispose).not.toHaveBeenCalled();
  pending.resolve({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } });
  await Promise.all([...cancellations, released]);
  expect(fake.create).toHaveBeenCalledOnce();
  expect(fake.contextDispose).toHaveBeenCalledOnce();
  expect(fake.generate).toHaveBeenCalledOnce();
  expect(fake.adapt).not.toHaveBeenCalled();
});

it('recovers from cancellation without reloading weights or forwarding late chunks', async () => {
  const engine = new LocalEngine('/model.gguf');
  const controller = new AbortController();
  fake.generate.mockImplementationOnce(
    (_input: unknown, options: { onTextChunk: (chunk: string) => void; signal: AbortSignal }) => {
      options.onTextChunk('こん');
      controller.abort(new Error('Cancelled'));
      options.onTextChunk('にちは');
      throw options.signal.reason;
    },
  );
  const chunks = vi.fn();
  await expect(
    engine.translate('Hello', 'Japanese', 'English', controller.signal, chunks),
  ).rejects.toThrow('Cancelled');
  expect(chunks.mock.calls).toEqual([['こん']]);
  await vi.waitFor(() => expect(fake.completionDispose).toHaveBeenCalledOnce());
  expect(fake.contextDispose).toHaveBeenCalledOnce();
  fake.generate.mockResolvedValueOnce({
    response: 'こんにちは',
    metadata: { stopReason: 'eogToken' },
  });
  await engine.translate('Hello again', 'Japanese', 'English');
  expect(fake.create).toHaveBeenCalledTimes(2);
  expect(fake.load).toHaveBeenCalledOnce();
});

it('discards the context if instruction-cache cleanup fails', async () => {
  const engine = new LocalEngine('/model.gguf');
  fake.generate.mockResolvedValue({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } });
  fake.adapt.mockRejectedValueOnce(new Error('Cache failure'));
  await expect(engine.translate('Hello', 'Japanese', 'English')).rejects.toThrow('Cache failure');
  await engine.translate('Hello again', 'Japanese', 'English');
  expect(fake.create).toHaveBeenCalledTimes(2);
  expect(fake.contextDispose).toHaveBeenCalledOnce();
});

it('uses the current source and target language when direction changes', async () => {
  const engine = new LocalEngine('/model.gguf');
  fake.generate
    .mockResolvedValueOnce({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } })
    .mockResolvedValueOnce({ response: 'Goodbye', metadata: { stopReason: 'eogToken' } });
  await engine.translate('Hello', 'Japanese', 'English');
  await expect(engine.translate('さようなら', 'Japanese', 'English')).resolves.toMatchObject({
    translation: 'Goodbye',
    targetLanguage: 'English',
  });
  const fullInputs = fake.text.mock.calls.filter(parts => parts.length === 3);
  expect(fullInputs[0]?.[1]).toMatch(/^Translate the following text into Japanese\..*\nHello$/);
  expect(fullInputs[1]?.[1]).toMatch(/^Translate the following text into English\..*\nさようなら$/);
  const prefixes = fake.text.mock.calls.filter(parts => parts.length === 2);
  expect(prefixes[1]?.[1]).toMatch(/^Translate the following text into English\..*\n$/);
  expect(fake.create).toHaveBeenCalledOnce();
});

it('delivers cumulative chunks before generation finishes', async () => {
  const partial = Promise.withResolvers<{ response: string; metadata: { stopReason: string } }>();
  fake.generate.mockImplementationOnce(
    (_input: unknown, options: { onTextChunk: (chunk: string) => void }) => {
      options.onTextChunk('こん');
      options.onTextChunk('にちは');
      return partial.promise;
    },
  );
  const chunks = vi.fn();
  const result = new LocalEngine('/model.gguf').translate(
    'Hello',
    'Japanese',
    'English',
    undefined,
    chunks,
  );
  await vi.waitFor(() => expect(chunks).toHaveBeenCalledTimes(2));
  expect(chunks.mock.calls).toEqual([['こん'], ['こんにちは']]);
  partial.resolve({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } });
  await expect(result).resolves.toHaveProperty('translation', 'こんにちは');
});

it.each([
  [LOCAL_MODEL_ID, '<｜hy_begin▁of▁sentence｜><｜hy_User｜>', '<｜hy_Assistant｜>'],
  [LOCAL_7B_MODEL_ID, '<|startoftext|>', '<|extra_0|>'],
])('uses the model-specific role tokens for %s', async (id, start, end) => {
  fake.generate.mockResolvedValue({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } });
  await new LocalEngine('/model.gguf', getLocalModel(id)).translate(
    'Hello <|extra_0|>',
    'Japanese',
    'English',
  );
  expect(fake.text).toHaveBeenCalledWith(
    expect.objectContaining({ value: start }),
    expect.stringContaining('Hello <|extra_0|>'),
    expect.objectContaining({ value: end }),
  );
});

it('counts queue time in the deadline and skips expired work even before the timer fires', async () => {
  const engine = new LocalEngine('/model.gguf');
  const pending = Promise.withResolvers<{ response: string; metadata: { stopReason: string } }>();
  fake.generate.mockReturnValueOnce(pending.promise);
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const first = engine.translate('Hello', 'Japanese', 'English');
  await vi.waitFor(() => expect(fake.generate).toHaveBeenCalledOnce());
  const second = engine.translate('Hello again', 'Japanese', 'English');
  const failures = [
    expect(first).rejects.toThrow('90 seconds'),
    expect(second).rejects.toThrow('90 seconds'),
  ];
  now = 90_001;
  pending.resolve({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } });
  await Promise.all(failures);
  expect(fake.generate).toHaveBeenCalledOnce();
  await engine.release();
});

it('rejects release uncertainty and never reloads while the in-process GPU drain is unresolved', async () => {
  const engine = new LocalEngine('/model.gguf');
  const pending = Promise.withResolvers<{ response: string; metadata: { stopReason: string } }>();
  fake.generate.mockReturnValueOnce(pending.promise);
  const first = engine.translate('Hello', 'Japanese', 'English');
  await vi.waitFor(() => expect(fake.generate).toHaveBeenCalledOnce());
  const cancelled = expect(first).rejects.toThrow('released');
  vi.useFakeTimers();
  const release = engine.release();
  const uncertain = expect(release).rejects.toThrow('shutdown could not be confirmed');
  await vi.advanceTimersByTimeAsync(2000);
  await Promise.all([cancelled, uncertain]);
  expect(fake.contextDispose).not.toHaveBeenCalled();
  pending.resolve({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } });
  await expect(engine.translate('Next', 'Japanese', 'English')).rejects.toThrow(
    'shutdown could not be confirmed',
  );
  expect(fake.load).toHaveBeenCalledOnce();
  expect(fake.generate).toHaveBeenCalledOnce();
});

it('fails closed for already queued and subsequent work if context disposal fails', async () => {
  const engine = new LocalEngine('/model.gguf');
  fake.generate.mockResolvedValueOnce({ response: '', metadata: { stopReason: 'eogToken' } });
  fake.contextDispose.mockRejectedValueOnce(new Error('Dispose failed'));
  const first = engine.translate('Hello', 'Japanese', 'English');
  const queued = engine.translate('Next', 'Japanese', 'English');
  await expect(first).rejects.toThrow('shutdown could not be confirmed');
  await expect(queued).rejects.toThrow('shutdown could not be confirmed');
  await expect(engine.translate('Later', 'Japanese', 'English')).rejects.toThrow('Restart the app');
  expect(fake.create).toHaveBeenCalledOnce();
  expect(fake.load).toHaveBeenCalledOnce();
  expect(fake.generate).toHaveBeenCalledOnce();
  await expect(engine.release()).rejects.toThrow('shutdown could not be confirmed');
});

it('aborts warmup before model allocation and rejects source echoes', async () => {
  const engine = new LocalEngine('/model.gguf');
  const controller = new AbortController();
  controller.abort(new Error('Cancelled warmup'));
  await expect(engine.warmup('Japanese', controller.signal)).rejects.toThrow('Cancelled warmup');
  expect(fake.load).not.toHaveBeenCalled();
  fake.generate.mockResolvedValueOnce({ response: 'Hello', metadata: { stopReason: 'eogToken' } });
  await expect(engine.translate('Hello', 'Japanese', 'English')).rejects.toThrow(
    'valid translation',
  );
  await engine.release();
});
