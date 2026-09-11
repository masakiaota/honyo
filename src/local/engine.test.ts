import { afterEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
  generate: vi.fn(),
  text: vi.fn(),
  contextDispose: vi.fn(),
  modelDispose: vi.fn(),
  load: vi.fn(),
  create: vi.fn(),
}));
vi.mock('node-llama-cpp', () => {
  fake.create.mockResolvedValue({
    contextSize: 4096,
    getSequence: () => ({}),
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
      generateCompletionWithMeta = fake.generate;
    },
    LlamaText: fake.text.mockImplementation((): { tokenize: () => number[] } => ({
      tokenize: (): number[] => [1, 2, 3],
    })),
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
it('keeps weights across requests while disposing per-request contexts', async () => {
  const engine = new LocalEngine('/model.gguf');
  fake.generate.mockResolvedValue({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } });
  await engine.warmup();
  await engine.translate('Hello', 'Japanese', 'English');
  await engine.translate('Hello', 'Japanese', 'English');
  expect(fake.load).toHaveBeenCalledOnce();
  expect(fake.contextDispose).toHaveBeenCalledTimes(2);
  expect(fake.modelDispose).not.toHaveBeenCalled();
  await engine.release();
  expect(fake.modelDispose).toHaveBeenCalledOnce();
});
it('rejects truncated output and disposes the context on failure', async () => {
  fake.generate.mockResolvedValue({ response: '途中', metadata: { stopReason: 'maxTokens' } });
  await expect(
    new LocalEngine('/model.gguf').translate('Hello', 'Japanese', 'English'),
  ).rejects.toThrow('length limit');
  expect(fake.contextDispose).toHaveBeenCalledOnce();
});
it('does not start GPU work for an already cancelled request', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    new LocalEngine('/model.gguf').translate('Hello', 'Japanese', 'English', controller.signal),
  ).rejects.toThrow();
  expect(fake.load).not.toHaveBeenCalled();
});
it('serializes generation so two requests cannot allocate contexts concurrently', async () => {
  const engine = new LocalEngine('/model.gguf');
  const pending = Promise.withResolvers<{ response: string; metadata: { stopReason: string } }>();
  fake.generate
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } });
  const first = engine.translate('Hello', 'Japanese', 'English');
  await vi.waitFor(() => expect(fake.generate).toHaveBeenCalledOnce());
  const second = engine.translate('Hello again', 'Japanese', 'English');
  expect(fake.create).toHaveBeenCalledOnce();
  pending.resolve({ response: 'こんにちは', metadata: { stopReason: 'eogToken' } });
  await Promise.all([first, second]);
  expect(fake.create).toHaveBeenCalledTimes(2);
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
