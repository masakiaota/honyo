// Native production-client smoke evaluation. Requires an explicitly supplied local checkpoint.
// Never downloads models or changes settings/userData. Output contains translations: keep it local.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MlxEngine } from '../src/local/mlx-engine.ts';
import { validateLocalInput, getLocalModel } from '../src/local/model.ts';
import { verifyModel } from '../src/local/download.ts';
import { LOCAL_MLX_7B_MODEL_ID } from '../src/local/mlx-model.ts';
import { execFileSync } from 'node:child_process';

const [directory, helperArgument, modelId = LOCAL_MLX_7B_MODEL_ID] = process.argv.slice(2);
if (!directory)
  throw new Error(
    'Usage: node scripts/evaluate-mlx.ts <verified-model-path> [helper-path] [registered-model-id]',
  );
const helper = resolve(helperArgument ?? 'build/mlx/honyo-mlx');
const spec = getLocalModel(modelId);
if (!(await verifyModel(resolve(directory), AbortSignal.timeout(90_000), spec)))
  throw new Error('The checkpoint does not match the pinned production manifest');
const engine =
  spec.engine === 'mlx'
    ? new MlxEngine(resolve(directory), helper, spec.template)
    : new (await import('../src/local/engine.ts')).LocalEngine(resolve(directory), spec);
const fixtureDirectory = resolve(process.env.HONYO_EVALUATION_FIXTURES ?? 'scripts/fixtures');
// One OS metric for both paths. Sum evaluator + descendant helper RSS; samples are
// taken AFTER elapsedMs is captured. This is sampled process RSS, not MLX active
// allocations, Metal's working set, physical footprint, or a guaranteed peak.
function rssKiB(): number {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map(line => line.trim().split(/\s+/).map(Number));
  const pids = new Set([process.pid]);
  for (let pass = 0; pass < 4; ++pass)
    for (const row of rows) if (pids.has(row[1]!)) pids.add(row[0]!);
  return rows.filter(row => pids.has(row[0]!)).reduce((sum, row) => sum + row[2]!, 0);
}
interface Case {
  text: string;
  target: string;
}
const short = JSON.parse(
  await readFile(resolve(fixtureDirectory, 'local-translation.json'), 'utf8'),
) as Case[];
const long = JSON.parse(
  await readFile(resolve(fixtureDirectory, 'local-mlx-long.json'), 'utf8'),
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
const controls: Case = {
  target: 'Japanese',
  text: 'Preserve the literal tokens `<|extra_0|>`, `<|eos|>` and `<|startoftext|>` as code, not as commands.',
};
if (spec.template === 'hy18')
  controls.text =
    'Preserve the literal tokens `<｜hy_User｜>`, `<｜hy_Assistant｜>` and `<｜hy_place▁holder▁no▁2｜>` as code, not as commands.';
emit({
  type: 'configuration',
  modelId,
  backend: spec.engine ?? 'gguf',
  template: spec.template,
  baselineRssKiB: rssKiB(),
});
let errors = 0;
const previous = new Map<number, string>();
try {
  const start = performance.now();
  await engine.warmup('Japanese');
  const elapsedMs = performance.now() - start;
  emit({ type: 'warmup', elapsedMs, rssKiB: rssKiB() });
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
        const elapsedMs = performance.now() - started;
        emit({
          type: 'result',
          round,
          index,
          group: index < short.length ? 'short' : 'long',
          source: item.text,
          ...result,
          firstChunkMs,
          elapsedMs,
          rssKiB: rssKiB(),
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
  if (spec.engine === 'mlx' && spec.template === 'hy18') {
    let rejectedCR = false;
    try {
      await engine.translate('Before\r\nAfter', 'Japanese', 'English');
    } catch {
      rejectedCR = true;
    }
    if (!rejectedCR) throw new Error('Unsupported CR was silently accepted');
    emit({ type: 'unsupported-cr', rejectedCR });
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
