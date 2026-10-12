import { expect, it } from 'vitest';
import { getLocalModel, LOCAL_MODELS, LOCAL_MODEL_ID, isLocalModel } from './model.ts';
import { LOCAL_MLX_7B_MODEL_ID, MLX_REVISION } from './mlx-model.ts';

it('offers exactly lightweight 1.8B GGUF and higher-quality 7B MLX', () => {
  expect(Object.keys(LOCAL_MODELS)).toEqual([LOCAL_MODEL_ID, LOCAL_MLX_7B_MODEL_ID]);
  expect(LOCAL_MODEL_ID).toBe('local-hy-mt-1.8b');
  expect(getLocalModel().file).toBe('Hy-MT2-1.8B-Q4_K_M.gguf');
  expect(getLocalModel().sha256).toBe(
    'dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699',
  );
  expect(getLocalModel().engine).toBeUndefined();
  expect(isLocalModel(LOCAL_MLX_7B_MODEL_ID)).toBe(true);
  expect(getLocalModel(LOCAL_MLX_7B_MODEL_ID).engine).toBe('mlx');
});

it.each(['local-hy-mt2-7b-q4', 'local-hy-mt2-1.8b-mlx-4bit'])(
  'rejects removed model %s instead of keeping a hidden compatibility alias',
  id => {
    expect(isLocalModel(id)).toBe(false);
    expect(() => getLocalModel(id)).toThrow('Unknown offline model');
  },
);

it('pins every MLX asset and its license to one revision with individual checksums', () => {
  const model = getLocalModel(LOCAL_MLX_7B_MODEL_ID);
  expect(model.assets?.length).toBe(9);
  expect(model.bytes).toBe(model.assets?.reduce((sum, asset) => sum + asset.bytes, 0));
  expect(new Set(model.assets?.map(asset => asset.file)).size).toBe(9);
  for (const asset of model.assets ?? []) {
    expect(asset.url).toBe(
      `https://huggingface.co/mlx-community/Hy-MT2-7B-4bit/resolve/${MLX_REVISION}/${asset.file}`,
    );
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(asset.bytes).toBeGreaterThan(0);
  }
  expect(model.assets?.map(asset => asset.file)).toEqual(
    expect.arrayContaining([
      'model.safetensors',
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'LICENSE.txt',
    ]),
  );
  expect(model.licenseUrl).toContain(`/blob/${MLX_REVISION}/LICENSE.txt`);
});
