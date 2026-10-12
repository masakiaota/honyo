import type { LocalModel } from './model.ts';

export const LOCAL_MLX_7B_MODEL_ID = 'local-hy-mt2-7b-mlx-4bit';
export const MLX_REVISION = '9b7204bdb161490a8ce49ce607c1310cc3fd03ad';
const base = `https://huggingface.co/mlx-community/Hy-MT2-7B-4bit/resolve/${MLX_REVISION}`;

// Every runtime asset (including the license) is pinned and SHA-256 verified.
// These are MLX affine 4-bit weights, not renamed or converted GGUF Q3 weights.
const assets = [
  [
    'model.safetensors',
    4221806239,
    '3f4ae381527394ed768ca8eed3cf69940d9d54415bf555c26072d6c0d5f94a42',
  ],
  ['config.json', 1721, '03ce74a3e7160193621b85ac637537278de6214f2677513c35f3eb343056883a'],
  [
    'generation_config.json',
    217,
    '56cd0974cae79f49ecaec4a02936bcabed2a4c8d8b6a780bf4a94ccbf344a78b',
  ],
  ['tokenizer.json', 16388221, '4185389a69284fdd3ebf737c6120bbeee36cbed9763151fa5bac5986a39e05d4'],
  [
    'tokenizer_config.json',
    277,
    'c22cbe91c8a483be0947552bc45505f4f5d32b1d5ad6bdaa38e49f5aac6d8e7a',
  ],
  [
    'model.safetensors.index.json',
    57380,
    '20976f5c66c1dd333a2877f7d253b0ceb5188bad283b001cd6248f3e054bb82d',
  ],
  ['chat_template.jinja', 662, '788ac16c5d7bfefc28655928ad524c8f378a44cb24d24fb125d6a5859b167677'],
  ['mlx_manifest.json', 322, '6c7c406dcc629e2382cb0afcb5ef33100adff10cd09374101fd2c3ca1bcee4a4'],
  ['LICENSE.txt', 11625, 'fccbe004b9870859aa97ba932e647cb1ac39f54716ef008ddf666d86a34ffd98'],
] as const;

export const LOCAL_MLX_7B_MODEL: LocalModel = {
  name: 'Hy-MT2 7B · Higher quality',
  memory: 'About 4.2 GB resident memory · 16 GB RAM or more recommended',
  template: 'hy7',
  engine: 'mlx',
  file: `Hy-MT2-7B-MLX-4bit-${MLX_REVISION.slice(0, 12)}`,
  bytes: assets.reduce((sum, [, bytes]) => sum + bytes, 0),
  // For directory models, assets carry the checksums; url is also used for source links.
  sha256: assets[0][2],
  url: `${base}/model.safetensors`,
  licenseUrl: `${base.replace('/resolve/', '/blob/')}/LICENSE.txt`,
  assets: assets.map(([file, bytes, sha256]) => ({ file, bytes, sha256, url: `${base}/${file}` })),
};
