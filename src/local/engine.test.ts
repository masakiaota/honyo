import { afterEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
  generate: vi.fn(),
  text: vi.fn(),
  contextDispose: vi.fn(),
  completionDispose: vi.fn(),
  completion: vi.fn(),
  adapt: vi.fn(),
  sequence: vi.fn(),
  modelDispose: vi.fn(),
  load: vi.fn(),
  create: vi.fn(),
}));
vi.mock('node-llama-cpp', () => {
  fake.create.mockResolvedValue({
    contextSize: 4096,
    getSequence: fake.sequence.mockReturnValue({ adaptStateToTokens: fake.adapt }),
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
it('serializes requests and waits for generation before releasing shared state', async () => {
  const engine = new LocalEngine('/model.gguf');
  const pending = Promise.withResolvers<{ response: string; metadata: { stopReason: string } }>();
  fake.generate
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } });
  const first = engine.translate('Hello', 'Japanese', 'English');
  await vi.waitFor(() => expect(fake.generate).toHaveBeenCalledOnce());
  const second = engine.translate('Hello again', 'Japanese', 'English');
  const released = engine.release();
  expect(fake.create).toHaveBeenCalledOnce();
  expect(fake.generate).toHaveBeenCalledOnce();
  expect(fake.contextDispose).not.toHaveBeenCalled();
  pending.resolve({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } });
  await Promise.all([first, second, released]);
  expect(fake.create).toHaveBeenCalledOnce();
  expect(fake.contextDispose).toHaveBeenCalledOnce();
  expect(fake.adapt).toHaveBeenCalledTimes(2);
  expect(fake.adapt).toHaveBeenCalledBefore(fake.contextDispose);
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
  expect(fake.contextDispose).toHaveBeenCalledOnce();
  expect(fake.completionDispose).toHaveBeenCalledOnce();
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
