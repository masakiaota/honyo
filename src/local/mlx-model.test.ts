import { expect, it } from 'vitest';
import { getLocalModel, LOCAL_MODEL_ID, LOCAL_MODELS, isLocalModel } from './model.ts';
import { LOCAL_MLX_7B_MODEL_ID, MLX_REVISION } from './mlx-model.ts';

it('offers only 1.8B GGUF and 7B MLX, without legacy aliases or changing the default', () => {
  expect(Object.keys(LOCAL_MODELS)).toEqual([LOCAL_MODEL_ID, LOCAL_MLX_7B_MODEL_ID]);
  expect(getLocalModel().file).toBe('Hy-MT2-1.8B-Q4_K_M.gguf');
  expect(getLocalModel().engine).toBeUndefined();
  expect(getLocalModel(LOCAL_MLX_7B_MODEL_ID).engine).toBe('mlx');
  for (const id of ['local-hy-mt2-7b-q4', 'local-hy-mt2-1.8b-mlx-4bit']) {
    expect(isLocalModel(id)).toBe(false);
    expect(() => getLocalModel(id)).toThrow('Unknown offline model');
  }
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
