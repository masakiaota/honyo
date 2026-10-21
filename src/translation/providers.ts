import type { Config } from '../config/types.ts';
import { getApiKeys } from '../config/index.ts';
import { getSelectedModelInfo, getOpenAIRequestOptions } from '../reasoning-effort.ts';
import { requestText } from '../openai/responses.ts';
import { withChatGPTToken, refreshChatGPTModels } from '../chatgpt/index.ts';

/** One text-generation entry point for translations, previews and prompt generation. */
export async function generateModelText(
  config: Config,
  instructions: string,
  input: string,
  onText?: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let model = getSelectedModelInfo(config);
  if (!model && config.aiModel.startsWith('chatgpt:')) {
    await refreshChatGPTModels();
    model = getSelectedModelInfo(config);
  }
  if (!model) throw new Error('Choose an available model in Model Settings.');
  if (model.provider === 'local') throw new Error('The offline model only supports translation.');
  const options = {
    model: model.model,
    instructions,
    input,
    ...getOpenAIRequestOptions(config, model),
    ...(onText ? { onText } : {}),
    ...(signal ? { signal } : {}),
  };
  if (model.provider === 'chatgpt')
    return withChatGPTToken(
      (token, requestSignal) => requestText({ ...options, token, signal: requestSignal }),
      signal,
    );
  const token = getApiKeys()[model.provider];
  if (!token) throw new Error('Save an API key for this provider in Model Settings.');
  if (model.provider === 'openai') return requestText({ ...options, token });
  const { streamText } = await import('ai');
  const otherModel =
    model.provider === 'anthropic'
      ? (await import('@ai-sdk/anthropic')).createAnthropic({ apiKey: token })(model.model)
      : (await import('@ai-sdk/google')).createGoogleGenerativeAI({ apiKey: token })(model.model);
  const result = streamText({
    model: otherModel,
    system: instructions,
    prompt: input,
    abortSignal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120_000)]),
    maxRetries: 0,
  });
  let text = '';
  for await (const part of result.fullStream) {
    if (part.type === 'error')
      throw new Error('The model request failed. Check the connection and provider settings.');
    if (part.type === 'text-delta') {
      text += part.text;
      onText?.(text);
    }
  }
  signal?.throwIfAborted();
  if (!text.trim()) throw new Error('The model returned no text.');
  return text;
}
