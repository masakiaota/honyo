import { describe, expect, it, vi } from 'vitest';
import { requestText } from './responses.ts';

const options = {
  token: 'test-private-token',
  model: 'gpt-6-luna',
  instructions: 'Translate.',
  input: 'Hello',
};
function events(...values: object[]): Response {
  return new Response(values.map(value => `data: ${JSON.stringify(value)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
const delta = { type: 'response.output_text.delta', delta: 'こんにちは' };
const done = { type: 'response.completed', response: { status: 'completed' } };

describe('Responses transport', () => {
  it.each(['gpt-5.6-sol', 'gpt-6-sol', 'gpt-6-luna'])(
    'sends none unchanged for %s and only returns after completion',
    async model => {
      const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
        const body: unknown = JSON.parse(init.body);
        expect(body).toEqual({
          model,
          instructions: 'Translate.',
          input: [{ role: 'user', content: 'Hello' }],
          store: false,
          stream: true,
          reasoning: { effort: 'none' },
        });
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-private-token');
        expect(new Headers(init?.headers).get('openai-project')).toBeNull();
        expect(_url).toBe('https://api.openai.com/v1/responses');
        return Promise.resolve(events(delta, done));
      });
      const onText = vi.fn();
      expect(await requestText({ ...options, model, effort: 'none', fetch, onText })).toBe(
        'こんにちは',
      );
      expect(onText).toHaveBeenCalledWith('こんにちは');
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
  it('passes accumulated text without a second caller-side buffer', async () => {
    const chunks: string[] = [];
    const fetch: typeof globalThis.fetch = () =>
      Promise.resolve(events(delta, { ...delta, delta: '。' }, done));
    expect(await requestText({ ...options, fetch, onText: text => chunks.push(text) })).toBe(
      'こんにちは。',
    );
    expect(chunks).toEqual(['こんにちは', 'こんにちは。']);
  });
  it.each([
    [[], 'before the response completed'],
    [[{ type: 'response.incomplete', response: {} }], 'incomplete'],
    [
      [
        {
          type: 'response.failed',
          response: {
            error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'private' },
          },
        },
      ],
      'Manage usage',
    ],
    [
      [{ type: 'error', code: 'subscription_sharing_unsupported_capability', message: 'private' }],
      'unavailable',
    ],
  ])('does not treat partial text as success: %j', async (terminal, message) => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(events(delta, ...terminal)));
    await expect(requestText({ ...options, fetch })).rejects.toThrow(message);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('does not expose HTTP response text or retry a failed request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'private server response' }), { status: 403 }),
      ),
    );
    await expect(requestText({ ...options, fetch })).rejects.toThrow('HTTP 403');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('aborts a partially streamed request', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(events(delta, done)));
    await expect(
      requestText({
        ...options,
        fetch,
        signal: controller.signal,
        onText: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each([true, false])(
    'clears its deadline after a finished request (success=%s)',
    async success => {
      vi.useFakeTimers();
      try {
        const fetch: typeof globalThis.fetch = () =>
          Promise.resolve(events(delta, ...(success ? [done] : [])));
        const pending = requestText({ ...options, fetch });
        if (success) await expect(pending).resolves.toBe('こんにちは');
        else await expect(pending).rejects.toThrow('before the response completed');
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('still aborts requests at the deadline and releases the timer', async () => {
    vi.useFakeTimers();
    try {
      const started = Promise.withResolvers<void>();
      const fetch: typeof globalThis.fetch = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            {
              once: true,
            },
          );
          started.resolve();
        });
      const pending = requestText({ ...options, fetch });
      const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      await started.promise;
      await vi.advanceTimersByTimeAsync(120_000);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects empty successful responses', async () => {
    await expect(
      requestText({ ...options, fetch: () => Promise.resolve(events(done)) }),
    ).rejects.toThrow('no text');
  });
});
