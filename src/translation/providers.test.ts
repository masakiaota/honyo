import { beforeEach, expect, it, vi } from 'vitest';
import type { ApiKeys, Config } from '../config/types.ts';
import type { AIModelInfo } from '../models.ts';
const mock = vi.hoisted(() => ({
  aiLoaded: vi.fn(),
  anthropicLoaded: vi.fn(),
  googleLoaded: vi.fn(),
  stream: vi.fn(),
  anthropic: vi.fn(),
  google: vi.fn(),
  request: vi.fn(),
  model: vi.fn<(config: Config) => AIModelInfo | undefined>(),
  options: vi.fn(),
}));
vi.mock('../config/index.ts', () => ({
  getApiKeys: (): ApiKeys => ({
    openai: 'api-key',
    anthropic: 'anthropic-key',
    google: 'google-key',
  }),
}));
vi.mock('../reasoning-effort.ts', () => ({
  getSelectedModelInfo: mock.model,
  getOpenAIRequestOptions: mock.options,
}));
vi.mock('../chatgpt/index.ts', () => ({
  withChatGPTToken: (
    operation: (token: string, signal: AbortSignal) => Promise<string>,
  ): Promise<string> => operation('oauth-token', new AbortController().signal),
  refreshChatGPTModels: vi.fn(),
}));
vi.mock('../openai/responses.ts', () => ({ requestText: mock.request }));
vi.mock('ai', () => {
  mock.aiLoaded();
  return { streamText: mock.stream };
});
vi.mock('@ai-sdk/anthropic', () => {
  mock.anthropicLoaded();
  return { createAnthropic: mock.anthropic };
});
vi.mock('@ai-sdk/google', () => {
  mock.googleLoaded();
  return { createGoogleGenerativeAI: mock.google };
});
import { generateModelText } from './providers.ts';
const config: Config = {
  aiModel: 'test',
  targetLanguage: 'Japanese',
  secondaryLanguage: 'English',
  isPaused: false,
  customPrompt: '',
  maxInputCharacters: 4096,
  displayMode: 'popup',
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.options.mockReturnValue({ effort: 'none' });
  mock.request.mockResolvedValue('result');
});
it('uses the same resolved model and does not load unused provider SDKs for ChatGPT or OpenAI', async () => {
  for (const provider of ['chatgpt', 'openai'] as const) {
    const model: AIModelInfo = { provider, model: 'gpt-6-luna', name: 'Luna' };
    mock.model.mockReturnValue(model);
    expect(await generateModelText(config, 'Translate', 'Hello')).toBe('result');
    expect(mock.options).toHaveBeenLastCalledWith(config, model);
    expect(mock.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        token: provider === 'chatgpt' ? 'oauth-token' : 'api-key',
        effort: 'none',
      }),
    );
  }
  expect(mock.model).toHaveBeenCalledTimes(2);
  expect(mock.aiLoaded).not.toHaveBeenCalled();
  expect(mock.anthropicLoaded).not.toHaveBeenCalled();
  expect(mock.googleLoaded).not.toHaveBeenCalled();
});
it.each(['anthropic', 'google'] as const)(
  'still streams completed text through %s when selected',
  async provider => {
    mock.model.mockReturnValue({ provider, model: 'test-model', name: 'Test' });
    const factory = provider === 'anthropic' ? mock.anthropic : mock.google;
    factory.mockReturnValue(() => 'test-provider-model');
    mock.stream.mockReturnValue({
      fullStream: (async function* (): AsyncGenerator<{ type: string; text: string }> {
        await Promise.resolve();
        yield { type: 'text-delta', text: 'Hello' };
        yield { type: 'text-delta', text: ' world' };
      })(),
    });
    const partials: string[] = [];
    expect(
      await generateModelText(config, 'instructions', 'input', text => partials.push(text)),
    ).toBe('Hello world');
    expect(partials).toEqual(['Hello', 'Hello world']);
    expect(factory).toHaveBeenCalledWith({ apiKey: `${provider}-key` });
    expect(mock.request).not.toHaveBeenCalled();
  },
);
