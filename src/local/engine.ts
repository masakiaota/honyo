import type { LocalResult } from './model.ts';
import type { LlamaModel } from 'node-llama-cpp';
import { localDirection, validateLocalInput, validateLocalOutput } from './model.ts';

/** One GPU evaluation at a time; weights stay resident until explicitly released. */
export class LocalEngine {
  private model: LlamaModel | undefined;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly modelPath: string) {}

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action, action);
    this.tail = next.catch(() => undefined);
    return next;
  }

  warmup(): Promise<void> {
    return this.exclusive(async () => {
      if (this.model) return;
      const { getLlama } = await import('node-llama-cpp');
      const llama = await getLlama({ gpu: 'metal', build: 'never', maxThreads: 2 });
      this.model = await llama.loadModel({ modelPath: this.modelPath, gpuLayers: 'max' });
    });
  }

  release(): Promise<void> {
    return this.exclusive(async () => {
      await this.model?.dispose();
      this.model = undefined;
    });
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
      const { getLlama, LlamaCompletion, LlamaText, SpecialTokensText } =
        await import('node-llama-cpp');
      if (!this.model) {
        const llama = await getLlama({ gpu: 'metal', build: 'never', maxThreads: 2 });
        this.model = await llama.loadModel({ modelPath: this.modelPath, gpuLayers: 'max' });
      }
      boundedSignal.throwIfAborted();
      const context = await this.model.createContext({
        contextSize: 4096,
        batchSize: 128,
        threads: 2,
        flashAttention: true,
      });
      try {
        // Source remains ordinary text: model special tokens in copied text cannot create roles.
        const input = LlamaText(
          new SpecialTokensText('<｜hy_begin▁of▁sentence｜><｜hy_User｜>'),
          `Translate the following text into ${direction.targetLanguage}. Note that you should only output the translated result without any additional explanation. Preserve meaning, negation, numbers, names, Markdown formatting, code and URLs exactly. Use standard Japanese technical terminology when translating into Japanese:\n${text}`,
          new SpecialTokensText('<｜hy_Assistant｜>'),
        );
        const tokens = input.tokenize(this.model.tokenizer);
        const maxTokens = Math.min(2048, context.contextSize - tokens.length - 16);
        if (maxTokens < 512)
          throw new Error('The text is too long. Please split it into shorter passages.');
        const completion = new LlamaCompletion({ contextSequence: context.getSequence() });
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
        validateLocalOutput(translation, direction.targetLanguage, text);
        return { translation, ...direction };
      } finally {
        await context.dispose();
      }
    });
  }
}
