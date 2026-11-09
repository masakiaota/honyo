import { expect, it } from 'vitest';
import { getLocalModel, LOCAL_MODEL_ID, LOCAL_MODELS, isLocalModel } from './model.ts';

it('offers the four PLaMo sizes through one runtime, with the smallest as the default', () => {
  expect(Object.keys(LOCAL_MODELS)).toEqual(
    ['0.8b', '2b', '8b', '31b'].map(size => 'local-plamo-3-' + size),
  );
  expect(LOCAL_MODEL_ID).toBe('local-plamo-3-0.8b');
  for (const id of ['local-hy-mt-1.8b', 'local-hy-mt2-7b-mlx-4bit', '../unknown']) {
    expect(isLocalModel(id)).toBe(false);
    expect(() => getLocalModel(id)).toThrow('Unknown offline model');
  }
});

it.each(Object.keys(LOCAL_MODELS))('pins every %s asset and license to one revision', id => {
  const model = getLocalModel(id);
  expect(model.bytes).toBe(model.assets.reduce((sum, asset) => sum + asset.bytes, 0));
  expect(new Set(model.assets.map(asset => asset.file)).size).toBe(model.assets.length);
  const revisions = new Set<string>();
  for (const asset of model.assets) {
    const revision = asset.url.match(/\/resolve\/([a-f0-9]{40})\//)?.[1];
    expect(revision).toBeDefined();
    if (revision) revisions.add(revision);
    expect(asset.url).toContain(model.sourceUrl + '/resolve/');
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(asset.bytes).toBeGreaterThan(0);
    expect(asset.file).not.toContain('/');
  }
  expect(revisions.size).toBe(1);
  expect(model.assets.map(asset => asset.file)).toEqual(
    expect.arrayContaining([
      'config.json',
      'tokenizer.jsonl',
      'tokenizer_config.json',
      'LICENSE-ja.txt',
      'LICENSE-en.txt',
    ]),
  );
  expect(model.licenseUrl).toBe(model.sourceUrl + '/blob/' + [...revisions][0] + '/LICENSE/ja');
});
