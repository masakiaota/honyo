import type { ReasoningEffort } from 'openai/resources/shared';

export class InferenceError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'InferenceError';
  }
}
export function inferenceError(code?: string, status?: number): InferenceError {
  const messages: Record<string, string> = {
    subscription_sharing_usage_limit_exceeded:
      'ChatGPT plan usage limit reached. Open Manage usage in Model Settings.',
    subscription_sharing_user_not_eligible:
      'This account or workspace is not eligible to use its ChatGPT plan here.',
    subscription_sharing_usage_unavailable:
      'ChatGPT usage is temporarily unavailable. Try again later.',
    subscription_sharing_unsupported_capability:
      'The selected model or option is unavailable for this ChatGPT connection. Choose another option.',
  };
  return new InferenceError(
    (code && messages[code]) ||
      (status === 401
        ? 'Authorization was not accepted. Reconnect ChatGPT or check your API key.'
        : status === 429
          ? 'The usage limit was reached. Check your usage before retrying.'
          : `The model request failed${status ? ` (HTTP ${status})` : ''}. Try again or choose another model.`),
    code,
    status,
  );
}

/** Text-only requests share one transport, regardless of how the bearer credential was obtained. */
export async function requestText(options: {
  token: string;
  model: string;
  instructions: string;
  input: string;
  effort?: ReasoningEffort;
  serviceTier?: 'priority';
  signal?: AbortSignal;
  onText?: (text: string) => void;
  fetch?: typeof globalThis.fetch;
}): Promise<string> {
  options.signal?.throwIfAborted();
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({
    apiKey: options.token,
    baseURL: 'https://api.openai.com/v1',
    organization: null,
    project: null,
    maxRetries: 0,
    logLevel: 'off',
    fetchOptions: { redirect: 'error' },
    defaultHeaders: {
      authorization: `Bearer ${options.token}`,
      'openai-organization': null,
      'openai-project': null,
    },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const deadline = new AbortController();
  const timeout = setTimeout(() => {
    deadline.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  }, 120_000);
  timeout.unref();
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  try {
    signal.throwIfAborted();
    const stream = await client.responses.create(
      {
        model: options.model,
        instructions: options.instructions,
        input: [{ role: 'user', content: options.input }],
        store: false,
        stream: true,
        ...(options.effort ? { reasoning: { effort: options.effort } } : {}),
        ...(options.serviceTier ? { service_tier: options.serviceTier } : {}),
      },
      { signal },
    );
    let text = '',
      completed = false;
    try {
      for await (const event of stream) {
        signal.throwIfAborted();
        if (event.type === 'response.output_text.delta') {
          text += event.delta;
          options.onText?.(text);
        } else if (event.type === 'response.failed') {
          throw inferenceError(event.response.error?.code);
        } else if (event.type === 'response.incomplete') {
          throw new InferenceError('The response was incomplete. Try a shorter input.');
        } else if (event.type === 'error') {
          throw inferenceError(event.code ?? undefined);
        } else if (event.type === 'response.completed') {
          completed = true;
          break;
        }
      }
      signal.throwIfAborted();
      if (!completed)
        throw new InferenceError('The connection ended before the response completed.');
      if (!text.trim()) throw new InferenceError('The model returned no text.');
      return text;
    } finally {
      stream.controller.abort();
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof InferenceError) throw error;
    if (error instanceof OpenAI.APIError)
      throw inferenceError(
        error.code ?? undefined,
        typeof error.status === 'number' ? error.status : undefined,
      );
    throw new InferenceError('Could not reach OpenAI. Check the connection and try again.');
  } finally {
    clearTimeout(timeout);
  }
}
