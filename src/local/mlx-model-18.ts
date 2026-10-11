import type { LocalModel } from './model.ts';

export const LOCAL_MLX_18_MODEL_ID = 'local-hy-mt2-1.8b-mlx-4bit';
export const MLX_18_REVISION = 'e5c6fe56c7b3bc77fae5ae92db31f2178f1e6912';
const base = `https://huggingface.co/mlx-community/Hy-MT2-1.8B-4bit/resolve/${MLX_18_REVISION}`;
const assets = [
  [
    'model.safetensors',
    1007776125,
    'a9cecbc77050b86b2fa3df3a8941d34ed3585cdbcce07bd64b3da289d50537c6',
  ],
  ['config.json', 1688, '63180daf56cf2ca15223b358eae0bcb5252b7fd4bfa2b2882b36e82f4c410da8'],
  [
    'generation_config.json',
    221,
    '0e28667f1cb4c7b880b9223b2d87978f88e79ed7ae037de1021f826c18d4ed6f',
  ],
  ['tokenizer.json', 9527287, 'b475bbef1b0b2fd57dcb865332b546475bd1ede2deb3bb91bafd0c047a8a530a'],
  [
    'tokenizer_config.json',
    359,
    '9c8fad86305966b62964ad3f4b56d00fb3234141028a31710ca312ba3e417cd9',
  ],
  [
    'model.safetensors.index.json',
    57380,
    '6026955be1656bf6cf7b9ffd56aac91c88287ba13fbab8b9f140655464b9de4b',
  ],
  ['chat_template.jinja', 654, 'b7491ec0e9c869dfce20f2176758099bf248d979dd05530ede99deb21698acee'],
  ['mlx_manifest.json', 375, '73de5f79e38fc86ec2a0a3a7e7ad830c049064b8de09686bb2c4de92a7819c35'],
  ['LICENSE.txt', 11629, '1af3c6dc0c697277cbb6b68720787c1caa43a79c5626bf9f19cd8c00de9c8cd4'],
] as const;

export const LOCAL_MLX_18_MODEL: LocalModel = {
  name: 'Hy-MT2 1.8B · MLX · Offline',
  memory: 'Lightweight 1.8B · MLX 4-bit',
  template: 'hy18',
  engine: 'mlx',
  file: `Hy-MT2-1.8B-MLX-4bit-${MLX_18_REVISION.slice(0, 12)}`,
  bytes: assets.reduce((sum, [, bytes]) => sum + bytes, 0),
  sha256: assets[0][2],
  url: `${base}/model.safetensors`,
  licenseUrl: `${base.replace('/resolve/', '/blob/')}/LICENSE.txt`,
  assets: assets.map(([file, bytes, sha256]) => ({ file, bytes, sha256, url: `${base}/${file}` })),
};
