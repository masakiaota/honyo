# Native local MLX helper

`honyo-mlx <model-dir>` is a resident, sequential JSONL subprocess, not a server.
It supports only the local `hunyuan_v1_dense` checkpoint and a fixed 4096-token
context. No model, tokenizer, chat template, or Python is downloaded at runtime.
Node owns cancellation/timeouts: terminate the process, discard its KV cache,
and spawn a new process for the next request.

## Build and package

Requires Apple Silicon, macOS 14+, full Xcode with the Metal toolchain, and Swift
6.2+. Tested with Xcode 27.0 / Swift 6.4. First compilation may fetch Git package
sources; exact top-level versions and every transitive revision are pinned in
`Package.swift` and `Package.resolved`. Builds refuse automatic package version
resolution and fail if the lock changes. Production builds explicitly disable
code coverage and reject helper binaries with LLVM coverage/profile sections,
including when tests were previously built in the same DerivedData directory.

From the repository root:

```sh
npm run build:mlx
```

The script uses `xcodebuild`, Release, `ARCHS=arm64`, deployment target 14.0, and
`output/native-mlx/DerivedData` plus `output/native-mlx/SourcePackages`. It emits:

- `build/mlx/honyo-mlx` (executable, ad-hoc hardened signature for development)
- `build/mlx/mlx-swift_Cmlx.bundle` (must contain a nonempty compiled
  `default.metallib` with the Metal library magic)
- Required Swift back-deployment `libswift*.dylib` files, when the toolchain
  autolinks them. These are discovered transitively, copied from that toolchain,
  and signed. `@loader_path` lets older macOS load the sibling libraries rather
  than accidentally relying on the build machine's system Swift libraries.
- `build/mlx/licenses/<identity>/`: LICENSE, NOTICE, and COPYING files for every
  pinned Swift dependency, including nested vendored C/C++ libraries. Builds
  verify checkout revisions and require each dependency's root license. A
  `dependencies.json` index and `Package.resolved` record their provenance.
  `licenses/swift-runtime/` includes the vendored upstream Apache 2.0 license
  with Runtime Library Exception, attribution, selected compiler version, and
  compatibility library names. No network is needed to retrieve these notices.

Run this **after** the existing TypeScript build: `scripts/build.ts` removes all
of `build/`. That integration belongs to the application's build script.
`build:mlx` itself deliberately fails on non-Apple-Silicon/non-macOS hosts; the
application build can skip invoking it on unsupported hosts.

`electron-builder.yml` excludes `build/mlx` from asar on every platform. Its
mac-only `extraResources` copies the complete helper, Metal bundle, and any
back-deployment dylibs and dependency licenses to `Contents/Resources/mlx`.
Global icon resources remain
included. The nested executable is explicitly listed for distribution signing;
dylibs are also discovered by electron-builder's recursive signing. No helper
JIT or unsandboxed executable-memory entitlement is required for Metal MLX.

Runtime paths:

- Development: `<appPath>/build/mlx/honyo-mlx`
- Packaged: `<resourcesPath>/mlx/honyo-mlx`

Startup validates the sibling bundle and loads its Metal library explicitly;
missing resources produce one `startup-error` JSONL record and exit code 3.
It never falls back to a developer's absolute DerivedData metallib path.

## Protocol

stdout contains only JSONL. The ready message has `type: "ready"`, `protocol: 1`,
`modelType: "hunyuan_v1_dense"`, and optional loading metrics. Requests require a
nonempty string `id`, `op: "warmup" | "translate"`, `target: "English" | "Japanese"`,
and nonempty string `instruction`; translation additionally requires nonempty
`text`. `{ "op": "exit" }` terminates cleanly; EOF also terminates.

A translation emits delta `chunk` records with `id` and `text`, followed by a
`result` with `response`, `stopReason`, `echoedSource`, `inputTokens`, `maxTokens`,
and `outputTokens`. Generation uses greedy sampling, repetition penalty 1.05,
context 64, prefill chunks 128, output ceiling 2048, a 16-token context safety
margin, and at least 512 available output tokens. Missing generation completion
metadata is an error, not a false success. Per-request errors emit
`{ "type": "error", "id": "...", "error": "..." }` and reset the cache.

Warmup only evaluates the BOS plus ordinary instruction tokens in chunks of 128. It ignores source text and never calls generation or a sampler. Its result
has `response: ""`, `stopReason: "warmup"`, `maxTokens: 0`, `outputTokens: 0`.

## Source-token and cache safeguards

`swift-transformers` 1.3.5 recognizes added-token spellings before its
postprocessor. **`addSpecialTokens: false` does not make source text safe.** The
helper constructs a second local byte-level BPE tokenizer with identical
ordinary vocabulary/merges, no added tokens, no normalization, and no output
cleanup. Instruction and source are encoded as ordinary text; only the prompt
builder inserts the BOS and translation separator control IDs. No characters
are escaped, removed, or replaced. Every ordinary encoding is checked both for
absence of reserved IDs and for UTF-8 byte-exact roundtrip (including decomposed
Unicode and CRLF). Unexpected tokenizer layouts fail closed.

After translations, retention is limited to the **contiguous matching instruction
prefix**, clamped to the minimum actual offset across **every** KV layer. The
same clamp applies before reuse and after warmup. Rewind verifies each layer's
actual offset; failed/untrimmable cache state is discarded. Source and generated
translation KV never remain resident between requests. Full prompt BPE and the
instruction prefix can merge differently at the source boundary, so equal
prefix length alone is never trusted.

## Swift tests

Run from `native/mlx`:

```sh
xcodebuild -scheme HonyoMlx -configuration Release \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath ../../output/native-mlx/DerivedData \
  -clonedSourcePackagesDirPath ../../output/native-mlx/SourcePackages \
  -onlyUsePackageVersionsFromResolvedFile -disableAutomaticPackageResolution \
  ARCHS=arm64 CODE_SIGNING_ALLOWED=NO MACOSX_DEPLOYMENT_TARGET=14.0 test
```

Pure tests cover contiguous-prefix matching, actual-offset retention clamping,
fixed-context budgets, protocol validation, literal role/control spellings, and
byte-exact text preservation. An additional test loads the real local tokenizer
without loading weights or running GPU inference. Enable it by prefixing the
command with `TEST_RUNNER_HONYO_MLX_TEST_MODEL=/absolute/local/model-dir`.
Without that variable only that integration test is skipped. On the tested
Hy-MT2-7B-4bit local checkpoint, every added-token spelling (209 entries) was
encoded as ordinary tokens and roundtripped exactly.

The native build and tests do not prove distribution notarization or execution
on older macOS, Intel Macs, or a universal Electron bundle. Those require release
packaging/OS coverage. The model can still obey adversarial _natural-language_
source instructions; these safeguards prevent injected tokenizer roles, not all
semantic prompt injection.
