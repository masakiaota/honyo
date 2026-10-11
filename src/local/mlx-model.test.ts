import { expect, it } from 'vitest';
import { getLocalModel, LOCAL_MODEL_ID, LOCAL_7B_MODEL_ID, isLocalModel } from './model.ts';
import { LOCAL_MLX_7B_MODEL_ID, MLX_REVISION } from './mlx-model.ts';

it('adds MLX as an explicit 7B choice without changing legacy models or the default', () => {
  expect(LOCAL_MODEL_ID).toBe('local-hy-mt-1.8b');
  expect(getLocalModel().file).toBe('Hy-MT2-1.8B-Q4_K_M.gguf');
  expect(getLocalModel(LOCAL_7B_MODEL_ID).file).toBe('Hy-MT2-7B-Q4_K_M.gguf');
  expect(getLocalModel().engine).toBeUndefined();
  expect(getLocalModel(LOCAL_7B_MODEL_ID).engine).toBeUndefined();
  expect(isLocalModel(LOCAL_MLX_7B_MODEL_ID)).toBe(true);
  expect(getLocalModel(LOCAL_MLX_7B_MODEL_ID).engine).toBe('mlx');
});

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
