import { expect, it } from 'vitest';
import { LOCAL_FAMILIES, localRuntime, recommendedLocalModel } from './catalog.ts';
import { getLocalModel, LOCAL_MODELS, LOCAL_MODEL_ID, LOCAL_7B_MODEL_ID } from './model.ts';
import { LOCAL_MLX_18_MODEL_ID, MLX_18_REVISION } from './mlx-model-18.ts';

it('groups all backends into two model families while retaining saved legacy IDs', () => {
  expect(LOCAL_FAMILIES.map(item => item.id)).toEqual(['hy18', 'hy7']);
  expect(Object.keys(LOCAL_MODELS)).toHaveLength(4);
  for (const id of Object.keys(LOCAL_MODELS)) {
    expect(localRuntime(id).family).toBe(getLocalModel(id).template);
    expect(localRuntime(id).recommended).toBe(
      recommendedLocalModel(getLocalModel(id).template) === id,
    );
  }
  expect(getLocalModel(LOCAL_MODEL_ID).sha256).toBe(
    'dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699',
  );
  expect(getLocalModel(LOCAL_7B_MODEL_ID).file).toBe('Hy-MT2-7B-Q4_K_M.gguf');
  expect(getLocalModel()).toBe(getLocalModel(LOCAL_MODEL_ID));
  // 1.8B MLX has a known CR vocabulary gap: do not silently recommend/migrate it.
  expect(recommendedLocalModel('hy18')).toBe(LOCAL_MODEL_ID);
});

it('pins the complete 1.8B MLX checkpoint and Apache license independently of 7B', () => {
  const model = getLocalModel(LOCAL_MLX_18_MODEL_ID);
  expect(model.template).toBe('hy18');
  expect(model.engine).toBe('mlx');
  expect(model.assets).toHaveLength(9);
  expect(model.bytes).toBe(model.assets?.reduce((sum, asset) => sum + asset.bytes, 0));
  expect(new Set(model.assets?.map(asset => asset.file)).size).toBe(9);
  for (const asset of model.assets ?? []) {
    expect(asset.url).toBe(
      `https://huggingface.co/mlx-community/Hy-MT2-1.8B-4bit/resolve/${MLX_18_REVISION}/${asset.file}`,
    );
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(asset.bytes).toBeGreaterThan(0);
  }
  expect(model.sha256).toBe('a9cecbc77050b86b2fa3df3a8941d34ed3585cdbcce07bd64b3da289d50537c6');
  expect(model.licenseUrl).toContain(`/blob/${MLX_18_REVISION}/LICENSE.txt`);
});
