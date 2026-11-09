import type { LocalModel } from './model.ts';

// Official PFN weights. Every asset is pinned to one immutable model revision.
export const PLAMO_MODELS: Record<string, LocalModel> = {
  'local-plamo-3-0.8b': {
    name: 'PLaMo 3 Translate 0.8B',
    file: 'plamo-3-translate-0.8b-MLX-4bit',
    memory: 'MLX 4bit · 0.98 GB download',
    sourceUrl: 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-MLX-4bit',
    licenseUrl:
      'https://huggingface.co/pfnet/plamo-3-translate-0.8b-MLX-4bit/blob/1f9227818908350380fa576794c01f5fbcbf8569/LICENSE/ja',
    bytes: 979376008,
    assets: [
      {
        file: 'LICENSE-en.txt',
        bytes: 9532,
        sha256: 'ca0c5e90f6de6799fc2d2d4f2b2647cc088444c19f286f689e525d4ad28f9ed6',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-MLX-4bit/resolve/1f9227818908350380fa576794c01f5fbcbf8569/LICENSE/en',
      },
      {
        file: 'LICENSE-ja.txt',
        bytes: 10713,
        sha256: '7dd74339bbf9a39fe33e271a89657aacf06f452b082fcb1273fb792b8d6b7db2',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-MLX-4bit/resolve/1f9227818908350380fa576794c01f5fbcbf8569/LICENSE/ja',
      },
      {
        file: 'config.json',
        bytes: 16913,
        sha256: '5175a9cd6ba7bab7eecafc508aa3278e58ece44d8edafa4a175ca067c4ed8c69',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-MLX-4bit/resolve/1f9227818908350380fa576794c01f5fbcbf8569/config.json',
      },
      {
        file: 'model.safetensors',
        bytes: 975810552,
        sha256: '4769685905d03c7f5ceaef316cbef245c9099f548f8dea00ecfdf980d698b29f',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-MLX-4bit/resolve/1f9227818908350380fa576794c01f5fbcbf8569/model.safetensors',
      },
      {
        file: 'tokenizer.jsonl',
        bytes: 3526723,
        sha256: 'bdce9e430e65931b28c56de2054f52b4cf8ed59b322db125e016d724d06dbb0e',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-MLX-4bit/resolve/1f9227818908350380fa576794c01f5fbcbf8569/tokenizer.jsonl',
      },
      {
        file: 'tokenizer_config.json',
        bytes: 1575,
        sha256: '5468ed5c68b5cf4cf971bcb34be6bfbfd749fe30cc5bc65ace5835ae3bff65b3',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-MLX-4bit/resolve/1f9227818908350380fa576794c01f5fbcbf8569/tokenizer_config.json',
      },
    ],
  },
  'local-plamo-3-2b': {
    name: 'PLaMo 3 Translate 2B',
    file: 'plamo-3-translate-2b-MLX-4bit',
    memory: 'MLX 4bit · 2.41 GB download',
    sourceUrl: 'https://huggingface.co/pfnet/plamo-3-translate-2b-MLX-4bit',
    licenseUrl:
      'https://huggingface.co/pfnet/plamo-3-translate-2b-MLX-4bit/blob/b715145bec63f0dfe877699adbef182439b2047a/LICENSE/ja',
    bytes: 2414545409,
    assets: [
      {
        file: 'LICENSE-en.txt',
        bytes: 9532,
        sha256: 'ca0c5e90f6de6799fc2d2d4f2b2647cc088444c19f286f689e525d4ad28f9ed6',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-2b-MLX-4bit/resolve/b715145bec63f0dfe877699adbef182439b2047a/LICENSE/en',
      },
      {
        file: 'LICENSE-ja.txt',
        bytes: 10713,
        sha256: '7dd74339bbf9a39fe33e271a89657aacf06f452b082fcb1273fb792b8d6b7db2',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-2b-MLX-4bit/resolve/b715145bec63f0dfe877699adbef182439b2047a/LICENSE/ja',
      },
      {
        file: 'config.json',
        bytes: 22914,
        sha256: 'dba9cddc2ce89752b025490fe2f40f59077c71db4d69b1ada16f6e6ae517133b',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-2b-MLX-4bit/resolve/b715145bec63f0dfe877699adbef182439b2047a/config.json',
      },
      {
        file: 'model-00001-of-00003.safetensors',
        bytes: 1073592520,
        sha256: '64018631034b196b9aa659e89489b36a51d5a51e06604547c26572046c61d5ec',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-2b-MLX-4bit/resolve/b715145bec63f0dfe877699adbef182439b2047a/model-00001-of-00003.safetensors',
      },
      {
        file: 'model-00002-of-00003.safetensors',
        bytes: 786878936,
        sha256: 'd716ed0bbd1bd921b2fab1192aee450dc1eeb42ca6cb0df689a191d40912e7cc',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-2b-MLX-4bit/resolve/b715145bec63f0dfe877699adbef182439b2047a/model-00002-of-00003.safetensors',
      },
      {
        file: 'model-00003-of-00003.safetensors',
        bytes: 550502496,
        sha256: '1de78bdebbdd0350666424a740a3d2f9a0d133aeb38e6968720a3ae5bcb7cae7',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-2b-MLX-4bit/resolve/b715145bec63f0dfe877699adbef182439b2047a/model-00003-of-00003.safetensors',
      },
      {
        file: 'tokenizer.jsonl',
        bytes: 3526723,
        sha256: 'bdce9e430e65931b28c56de2054f52b4cf8ed59b322db125e016d724d06dbb0e',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-2b-MLX-4bit/resolve/b715145bec63f0dfe877699adbef182439b2047a/tokenizer.jsonl',
      },
      {
        file: 'tokenizer_config.json',
        bytes: 1575,
        sha256: '5468ed5c68b5cf4cf971bcb34be6bfbfd749fe30cc5bc65ace5835ae3bff65b3',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-2b-MLX-4bit/resolve/b715145bec63f0dfe877699adbef182439b2047a/tokenizer_config.json',
      },
    ],
  },
  'local-plamo-3-8b': {
    name: 'PLaMo 3 Translate 8B',
    file: 'plamo-3-translate-8b-MLX-4bit',
    memory: 'MLX 4bit · 6.07 GB download',
    sourceUrl: 'https://huggingface.co/pfnet/plamo-3-translate-8b-MLX-4bit',
    licenseUrl:
      'https://huggingface.co/pfnet/plamo-3-translate-8b-MLX-4bit/blob/3623015236aa51fe290f02cff01135dfcadb9816/LICENSE/ja',
    bytes: 6069682121,
    assets: [
      {
        file: 'LICENSE-en.txt',
        bytes: 9532,
        sha256: 'ca0c5e90f6de6799fc2d2d4f2b2647cc088444c19f286f689e525d4ad28f9ed6',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-8b-MLX-4bit/resolve/3623015236aa51fe290f02cff01135dfcadb9816/LICENSE/en',
      },
      {
        file: 'LICENSE-ja.txt',
        bytes: 10713,
        sha256: '7dd74339bbf9a39fe33e271a89657aacf06f452b082fcb1273fb792b8d6b7db2',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-8b-MLX-4bit/resolve/3623015236aa51fe290f02cff01135dfcadb9816/LICENSE/ja',
      },
      {
        file: 'config.json',
        bytes: 28914,
        sha256: '8b0aaabea5316d7a9ee3f86b5ff324dd1aa5066b125a6c589350d2feb35ffd97',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-8b-MLX-4bit/resolve/3623015236aa51fe290f02cff01135dfcadb9816/config.json',
      },
      {
        file: 'model-00001-of-00006.safetensors',
        bytes: 1071894272,
        sha256: '389e0e505d6ef6363a829e9dffe1434d0dd35cd010280165259ce399c075c6bd',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-8b-MLX-4bit/resolve/3623015236aa51fe290f02cff01135dfcadb9816/model-00001-of-00006.safetensors',
      },
      {
        file: 'model-00002-of-00006.safetensors',
        bytes: 1042567552,
        sha256: '40632f803da03485f3c11d2a0ed6156eadea25e63a07509b741f1eeafe07ee9b',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-8b-MLX-4bit/resolve/3623015236aa51fe290f02cff01135dfcadb9816/model-00002-of-00006.safetensors',
      },
      {
        file: 'model-00003-of-00006.safetensors',
        bytes: 1071927752,
        sha256: '4069d868debb183816ef1d485f20cc1f482b712b227e65b6ac37f45505f3abc3',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-8b-MLX-4bit/resolve/3623015236aa51fe290f02cff01135dfcadb9816/model-00003-of-00006.safetensors',
      },
      {
        file: 'model-00004-of-00006.safetensors',
        bytes: 1071927752,
        sha256: 'a9723bd786b5021ca119705f2b44457e55937c1c595b36d81e98da0d6418d3fe',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-8b-MLX-4bit/resolve/3623015236aa51fe290f02cff01135dfcadb9816/model-00004-of-00006.safetensors',
      },
      {
        file: 'model-00005-of-00006.safetensors',
        bytes: 926983400,
        sha256: '19510e7d42e04ab07ba17b5fd64494b3a55c9eb6402a27def0daabfc8da59edd',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-8b-MLX-4bit/resolve/3623015236aa51fe290f02cff01135dfcadb9816/model-00005-of-00006.safetensors',
      },
      {
        file: 'model-00006-of-00006.safetensors',
        bytes: 880803936,
        sha256: 'c518dd91cc8b1127bf6d8ae29f06ab8f9f968be38a24480b8894b9731af0793e',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-8b-MLX-4bit/resolve/3623015236aa51fe290f02cff01135dfcadb9816/model-00006-of-00006.safetensors',
      },
      {
        file: 'tokenizer.jsonl',
        bytes: 3526723,
        sha256: 'bdce9e430e65931b28c56de2054f52b4cf8ed59b322db125e016d724d06dbb0e',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-8b-MLX-4bit/resolve/3623015236aa51fe290f02cff01135dfcadb9816/tokenizer.jsonl',
      },
      {
        file: 'tokenizer_config.json',
        bytes: 1575,
        sha256: '5468ed5c68b5cf4cf971bcb34be6bfbfd749fe30cc5bc65ace5835ae3bff65b3',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-8b-MLX-4bit/resolve/3623015236aa51fe290f02cff01135dfcadb9816/tokenizer_config.json',
      },
    ],
  },
  'local-plamo-3-31b': {
    name: 'PLaMo 3 Translate 31B',
    file: 'plamo-3-translate-31b-MLX-4bit',
    memory: 'MLX 4bit · 18.66 GB download',
    sourceUrl: 'https://huggingface.co/pfnet/plamo-3-translate-31b-MLX-4bit',
    licenseUrl:
      'https://huggingface.co/pfnet/plamo-3-translate-31b-MLX-4bit/blob/eeb4dcc2d38a9ada804e278515a8dcf30ff9804d/LICENSE/ja',
    bytes: 18660570600,
    assets: [
      {
        file: 'LICENSE-en.txt',
        bytes: 9532,
        sha256: 'ca0c5e90f6de6799fc2d2d4f2b2647cc088444c19f286f689e525d4ad28f9ed6',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-31b-MLX-4bit/resolve/eeb4dcc2d38a9ada804e278515a8dcf30ff9804d/LICENSE/en',
      },
      {
        file: 'LICENSE-ja.txt',
        bytes: 10713,
        sha256: '7dd74339bbf9a39fe33e271a89657aacf06f452b082fcb1273fb792b8d6b7db2',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-31b-MLX-4bit/resolve/eeb4dcc2d38a9ada804e278515a8dcf30ff9804d/LICENSE/ja',
      },
      {
        file: 'config.json',
        bytes: 52913,
        sha256: '3906c539c50ee0bfb03e8d94bd3087f7148b5cc2497405284b49d5e217006c28',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-31b-MLX-4bit/resolve/eeb4dcc2d38a9ada804e278515a8dcf30ff9804d/config.json',
      },
      {
        file: 'model-00001-of-00005.safetensors',
        bytes: 4167762184,
        sha256: 'b696cf444c89ac308a730b674cda39f2d967542c448ff9fd555307f85298d59a',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-31b-MLX-4bit/resolve/eeb4dcc2d38a9ada804e278515a8dcf30ff9804d/model-00001-of-00005.safetensors',
      },
      {
        file: 'model-00002-of-00005.safetensors',
        bytes: 4262133112,
        sha256: '249d4f8c6f2fd4e62567e03cac7320aea1daf2129d71eb3136804797aad691fa',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-31b-MLX-4bit/resolve/eeb4dcc2d38a9ada804e278515a8dcf30ff9804d/model-00002-of-00005.safetensors',
      },
      {
        file: 'model-00003-of-00005.safetensors',
        bytes: 4241532160,
        sha256: 'bfeac6102115c08eb6fbdd4cf20fcd6e071813a1a064c958be2fd041155e414c',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-31b-MLX-4bit/resolve/eeb4dcc2d38a9ada804e278515a8dcf30ff9804d/model-00003-of-00005.safetensors',
      },
      {
        file: 'model-00004-of-00005.safetensors',
        bytes: 4262133112,
        sha256: '527e0545cc3f270d0f1b92beae8498ce31d5e4b77ab87e5a84cf6090b484ce42',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-31b-MLX-4bit/resolve/eeb4dcc2d38a9ada804e278515a8dcf30ff9804d/model-00004-of-00005.safetensors',
      },
      {
        file: 'model-00005-of-00005.safetensors',
        bytes: 1723408576,
        sha256: '0ae8832a46df81f8b7126f70158a17c3295a84af960499900e94133060177bb5',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-31b-MLX-4bit/resolve/eeb4dcc2d38a9ada804e278515a8dcf30ff9804d/model-00005-of-00005.safetensors',
      },
      {
        file: 'tokenizer.jsonl',
        bytes: 3526723,
        sha256: 'bdce9e430e65931b28c56de2054f52b4cf8ed59b322db125e016d724d06dbb0e',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-31b-MLX-4bit/resolve/eeb4dcc2d38a9ada804e278515a8dcf30ff9804d/tokenizer.jsonl',
      },
      {
        file: 'tokenizer_config.json',
        bytes: 1575,
        sha256: '5468ed5c68b5cf4cf971bcb34be6bfbfd749fe30cc5bc65ace5835ae3bff65b3',
        url: 'https://huggingface.co/pfnet/plamo-3-translate-31b-MLX-4bit/resolve/eeb4dcc2d38a9ada804e278515a8dcf30ff9804d/tokenizer_config.json',
      },
    ],
  },
};
