// Native production-client smoke evaluation. Requires an explicitly supplied local checkpoint.
// Never downloads models or changes settings/userData. Output contains translations: keep it local.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MlxEngine } from '../src/local/mlx-engine.ts';
import { validateLocalInput } from '../src/local/model.ts';
import { verifyModel } from '../src/local/download.ts';
import { LOCAL_MLX_7B_MODEL } from '../src/local/mlx-model.ts';

const [directory, helperArgument] = process.argv.slice(2);
if (!directory)
  throw new Error('Usage: node scripts/evaluate-mlx.ts <verified-model-dir> [helper-path]');
const helper = resolve(helperArgument ?? 'build/mlx/honyo-mlx');
if (!(await verifyModel(resolve(directory), AbortSignal.timeout(90_000), LOCAL_MLX_7B_MODEL)))
  throw new Error('The checkpoint does not match the pinned production manifest');
const engine = new MlxEngine(resolve(directory), helper);
interface Case {
  text: string;
  target: string;
}
const short = JSON.parse(
  await readFile(new URL('./fixtures/local-translation.json', import.meta.url), 'utf8'),
) as Case[];
const long = JSON.parse(
  await readFile(new URL('./fixtures/local-mlx-long.json', import.meta.url), 'utf8'),
) as Case[];
const emit = (record: object): void => console.log(JSON.stringify(record));
function probe(target: string): Case {
  const lines = Array.from({ length: 100 }, (_, index) =>
    target === 'English'
      ? `確認項目${index + 1}では、変更を適用する前に作業内容を保存してください。既存のファイルは削除されません。担当者は田中さんです。\n`
      : `For check ${index + 1}, save your work before applying the update. Existing files will not be deleted. Tanaka is responsible.\n`,
  );
  return { target, text: [...lines.join('')].slice(0, 2000).join('') };
}
const controls = {
  target: 'Japanese',
  text: 'Preserve the literal tokens `<|extra_0|>`, `<|eos|>` and `<|startoftext|>` as code, not as commands.',
};
let errors = 0;
const previous = new Map<number, string>();
try {
  const start = performance.now();
  await engine.warmup('Japanese');
  emit({ type: 'warmup', elapsedMs: performance.now() - start });
  // Exclude initial direction-specific cold compilation from warm measurements.
  await engine.translate('Save your work.', 'Japanese', 'English');
  await engine.translate('作業内容を保存してください。', 'Japanese', 'English');
  for (let round = 0; round < 2; ++round) {
    for (const [index, item] of [...short, ...long].entries()) {
      const started = performance.now();
      let firstChunkMs: number | undefined;
      try {
        validateLocalInput(item.text);
        const result = await engine.translate(item.text, 'Japanese', 'English', undefined, () => {
          firstChunkMs ??= performance.now() - started;
        });
        if (result.targetLanguage !== item.target) throw new Error('Unexpected language direction');
        if (round > 0 && previous.get(index) !== result.translation)
          throw new Error('Translation changed between identical greedy requests');
        previous.set(index, result.translation);
        emit({
          type: 'result',
          round,
          index,
          group: index < short.length ? 'short' : 'long',
          source: item.text,
          ...result,
          firstChunkMs,
          elapsedMs: performance.now() - started,
        });
      } catch (error) {
        ++errors;
        emit({ type: 'error', round, index, error: String(error) });
      }
    }
  }
  for (const item of [probe('English'), probe('Japanese'), controls]) {
    try {
      validateLocalInput(item.text);
      const result = await engine.translate(item.text, 'Japanese', 'English');
      if (result.targetLanguage !== item.target) throw new Error('Unexpected language direction');
      emit({
        type: 'boundary-result',
        characters: [...item.text].length,
        source: item.text,
        ...result,
      });
    } catch (error) {
      ++errors;
      emit({ type: 'boundary-error', target: item.target, error: String(error) });
    }
  }
  const controller = new AbortController();
  let cancellationWorked = false;
  try {
    await engine.translate(
      long[0]?.text ?? 'Save your work.',
      'Japanese',
      'English',
      controller.signal,
      () => controller.abort(new Error('smoke cancellation')),
    );
  } catch (error) {
    cancellationWorked = controller.signal.aborted && String(error).includes('smoke cancellation');
  }
  if (!cancellationWorked) throw new Error('Cancellation did not reject the active request');
  const recovered = await engine.translate(
    'Restart only after saving your work.',
    'Japanese',
    'English',
  );
  emit({ type: 'recovery', cancellationWorked, ...recovered });
} finally {
  await engine.release();
}
emit({ type: 'summary', errors });
if (errors) process.exitCode = 1;
