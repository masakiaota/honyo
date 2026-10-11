import type { LocalResult, LocalModel } from './model.ts';
import type {
  LlamaCompletion,
  LlamaContext,
  LlamaContextSequence,
  LlamaModel,
} from 'node-llama-cpp';
import { LOCAL_MODEL, localDirection, validateLocalInput, validateLocalOutput } from './model.ts';

import { translationInstruction } from './prompt.ts';

/** One GPU evaluation at a time; weights and one instruction cache stay resident. */
export class LocalEngine {
  private model: LlamaModel | undefined;
  private context: LlamaContext | undefined;
  private sequence: LlamaContextSequence | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly operations = new Set<AbortController>();
  private stopping: Promise<void> = Promise.resolve();

  constructor(
    private readonly modelPath: string,
    private readonly spec: LocalModel = LOCAL_MODEL,
  ) {}

  private exclusive<T>(
    action: (signal: AbortSignal) => Promise<T>,
    external?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const signal = controller.signal;
    const deadline = performance.now() + 90_000;
    const result = Promise.withResolvers<T>();
    const cancel = (): void => controller.abort(external?.reason);
    const reject = (): void => result.reject(signal.reason);
    const check = (): void => {
      if (performance.now() >= deadline && !signal.aborted)
        controller.abort(
          new Error('Offline translation timed out after 90 seconds. Please retry.'),
        );
      signal.throwIfAborted();
    };
    const timer = setTimeout(
      () =>
        controller.abort(
          new Error('Offline translation timed out after 90 seconds. Please retry.'),
        ),
      90_000,
    );
    this.operations.add(controller);
    signal.addEventListener('abort', reject, { once: true });
    external?.addEventListener('abort', cancel, { once: true });
    if (external?.aborted) cancel();
    const run = async (): Promise<void> => {
      try {
        check();
        await this.stopping;
        check();
        const value = await action(signal);
        check();
        result.resolve(value);
      } catch (error) {
        result.reject(error);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', reject);
        external?.removeEventListener('abort', cancel);
        this.operations.delete(controller);
      }
    };
    // Abort callers promptly, but keep the drain barrier until native work actually ends.
    this.tail = this.tail.then(run, run);
    return result.promise;
  }

  warmup(targetLanguage = 'Japanese', external?: AbortSignal): Promise<void> {
    if (targetLanguage !== 'Japanese' && targetLanguage !== 'English')
      return Promise.reject(new Error('Offline translation supports English ↔ Japanese.'));
    return this.exclusive(async signal => {
      try {
        const { LlamaText, SpecialTokensText } = await import('node-llama-cpp');
        const { model, sequence } = await this.prepare(signal);
        const prefix = LlamaText(
          new SpecialTokensText(this.startTokens()),
          translationInstruction(targetLanguage),
        ).tokenize(model.tokenizer);
        await sequence.adaptStateToTokens(prefix, false);
        signal.throwIfAborted();
        const remaining = prefix.slice(sequence.nextTokenIndex);
        // Prefill only: no source text, assistant role, sampling or generated translation.
        if (remaining.length) await sequence.evaluateWithoutGeneratingNewTokens(remaining);
        signal.throwIfAborted();
      } catch (error) {
        await this.disposeContext();
        throw error;
      }
    }, external);
  }

  private startTokens(): string {
    return this.spec.template === 'hy7'
      ? '<|startoftext|>'
      : '<｜hy_begin▁of▁sentence｜><｜hy_User｜>';
  }

  private async prepare(signal: AbortSignal): Promise<{
    model: LlamaModel;
    context: LlamaContext;
    sequence: LlamaContextSequence;
  }> {
    signal.throwIfAborted();
    if (!this.model) {
      const { getLlama } = await import('node-llama-cpp');
      const llama = await getLlama({ gpu: 'metal', build: 'never', maxThreads: 2 });
      signal.throwIfAborted();
      this.model = await llama.loadModel({
        modelPath: this.modelPath,
        gpuLayers: 'max',
        loadSignal: signal,
      });
    }
    signal.throwIfAborted();
    const model = this.model;
    const context = (this.context ??= await model.createContext({
      contextSize: 4096,
      batchSize: 128,
      threads: 2,
      flashAttention: true,
      createSignal: signal,
    }));
    const sequence = (this.sequence ??= context.getSequence());
    signal.throwIfAborted();
    return { model, context, sequence };
  }

  release(): Promise<void> {
    for (const operation of this.operations)
      operation.abort(new Error('The offline model was released.'));
    const previous = this.stopping;
    const drained = this.tail.then(async () => {
      const model = this.model;
      this.model = undefined;
      try {
        await this.disposeContext();
      } finally {
        await model?.dispose();
      }
    });
    this.tail = drained.catch(() => undefined);
    // In-process GPU work cannot be killed safely. Fail closed if draining is uncertain;
    // a later request must not allocate replacement weights even if work eventually ends.
    this.stopping = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              'Offline engine shutdown could not be confirmed. Restart the app to recover.',
            ),
          ),
        2000,
      );
      void Promise.all([previous, drained]).then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(
            error instanceof Error
              ? error
              : new Error(
                  'Offline engine shutdown could not be confirmed. Restart the app to recover.',
                ),
          );
        },
      );
    });
    void this.stopping.catch(() => undefined);
    return this.stopping;
  }

  private async disposeContext(): Promise<void> {
    const context = this.context;
    this.context = undefined;
    this.sequence = undefined;
    try {
      await context?.dispose();
    } catch {
      const error = new Error(
        'Offline engine shutdown could not be confirmed. Restart the app to recover.',
      );
      this.stopping = Promise.reject(error);
      void this.stopping.catch(() => undefined);
      throw error;
    }
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
    return this.exclusive(async boundedSignal => {
      boundedSignal.throwIfAborted();
      const { LlamaCompletion, LlamaText, SpecialTokensText } = await import('node-llama-cpp');
      let completion: LlamaCompletion | undefined;
      try {
        const { model, context, sequence } = await this.prepare(boundedSignal);
        const start = new SpecialTokensText(this.startTokens());
        const instruction = translationInstruction(direction.targetLanguage);
        // Source remains ordinary text: model special tokens in copied text cannot create roles.
        const input = LlamaText(
          start,
          instruction + text,
          new SpecialTokensText(
            this.spec.template === 'hy7' ? '<|extra_0|>' : '<｜hy_Assistant｜>',
          ),
        );
        const tokens = input.tokenize(model.tokenizer);
        const maxTokens = Math.min(2048, context.contextSize - tokens.length - 16);
        if (maxTokens < 512)
          throw new Error('The text is too long. Please split it into shorter passages.');
        // Completion aligns the sequence to this full input, reusing only its matching prefix.
        completion = new LlamaCompletion({ contextSequence: sequence });
        let streamed = '';
        const result = await completion.generateCompletionWithMeta(tokens, {
          onTextChunk: chunk => {
            streamed += chunk;
            if (!boundedSignal.aborted) onChunk?.(streamed);
          },
          signal: boundedSignal,
          maxTokens,
          temperature: 0,
          repeatPenalty: { penalty: 1.05 },
          disableContextShift: true,
        });
        boundedSignal.throwIfAborted();
        if (result.metadata.stopReason === 'maxTokens')
          throw new Error('Translation reached its length limit. Please split the text and retry.');
        const translation = result.response.trim();
        validateLocalOutput(translation, text);
        if (translation === text.trim())
          throw new Error('Could not generate a valid translation. Try a shorter passage.');
        // Remove the source and result. Token alignment also handles a token that spans
        // the instruction/source boundary; that token must be evaluated again next time.
        await sequence.adaptStateToTokens(
          LlamaText(start, instruction).tokenize(model.tokenizer),
          false,
        );
        boundedSignal.throwIfAborted();
        return { translation, ...direction };
      } catch (error) {
        await this.disposeContext();
        throw error;
      } finally {
        completion?.dispose({ disposeSequence: false });
      }
    }, signal);
  }
}
