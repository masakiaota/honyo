import type { LocalResult, LocalModel } from './model.ts';
import type {
  LlamaCompletion,
  LlamaContext,
  LlamaContextSequence,
  LlamaModel,
} from 'node-llama-cpp';
import { LOCAL_MODEL, localDirection, validateLocalInput, validateLocalOutput } from './model.ts';

function translationInstruction(targetLanguage: string): string {
  return `Translate the following text into ${targetLanguage}. Note that you should only output the translated result without any additional explanation. Preserve meaning, negation, numbers, names, Markdown formatting, code and URLs exactly. Use standard Japanese technical terminology when translating into Japanese:\n`;
}

/** One GPU evaluation at a time; weights and one instruction cache stay resident. */
export class LocalEngine {
  private model: LlamaModel | undefined;
  private context: LlamaContext | undefined;
  private sequence: LlamaContextSequence | undefined;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly modelPath: string,
    private readonly spec: LocalModel = LOCAL_MODEL,
  ) {}

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action, action);
    this.tail = next.catch(() => undefined);
    return next;
  }

  warmup(targetLanguage = 'Japanese'): Promise<void> {
    return this.exclusive(async () => {
      const signal = AbortSignal.timeout(90_000);
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
    });
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
      this.model = await llama.loadModel({ modelPath: this.modelPath, gpuLayers: 'max' });
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
    return this.exclusive(async () => {
      const model = this.model;
      this.model = undefined;
      try {
        await this.disposeContext();
      } finally {
        await model?.dispose();
      }
    });
  }

  private async disposeContext(): Promise<void> {
    const context = this.context;
    this.context = undefined;
    this.sequence = undefined;
    await context?.dispose();
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
    return this.exclusive(async () => {
      const boundedSignal = AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(90_000),
      ]);
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
    });
  }
}
