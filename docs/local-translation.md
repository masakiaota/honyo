# Local translation on M3 Air

The default local model is **Tencent Hy-MT2 1.8B Q4_K_M** (1,133,080,448 bytes). It offers a useful balance of latency, memory, and translation discipline for a menu-bar application. This is a practical selection from a small manual evaluation, not a claim that it is the best model on a representative Japanese-English benchmark.

For a follow-up focused on time to first visible text, see the [48-case streaming and quality comparison](translation-streaming-comparison.md).

The [additional three-model evaluation](additional-local-models.md) covers newer Japanese LFM, Qwen3.5 4B, and Shisa 3B models with 60 cases and a separate input-framing check.

## Comparison

Measured on this M3 MacBook Air, 24 GB unified memory, macOS, using node-llama-cpp 3.20.0, Metal, 2 CPU threads, 4,096-token contexts, batch size 128, flash attention, greedy decoding, repetition penalty 1.05, and a fresh context for every input. Models ran sequentially; ordinary desktop workloads and downloads continued in the background. These are approximate application-oriented measurements, not isolated lab benchmarks. RSS is the inference process's resident memory, not whole-system memory or a hard memory cap.

Each row used the same [20 English/Japanese examples](../scripts/fixtures/local-translation.json). The fixture covers negation, deadlines, currency, proper names, code, links, idioms, and instruction-shaped source text. Outputs were manually inspected for meaning changes and formatting problems; no automatic quality score is claimed.

| Model                    |    Download | Median completion | Maximum observed RSS | Decision and observed issues                                                                                                                                                                         |
| ------------------------ | ----------: | ----------------: | -------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LFM2-350M-ENJP-MT Q4_K_M |     0.23 GB |            0.14 s |              507 MiB | Rejected as default: changed yen to won; corrupted a URL and removed the heading. Fastest by a wide margin.                                                                                          |
| **Hy-MT2 1.8B Q4_K_M**   | **1.13 GB** |        **0.74 s** |        **1,629 MiB** | **Selected**: preserved the deadline, currency, names, and tested Markdown. Technical terminology and context-sensitive phrases remain imperfect.                                                    |
| Hy-MT2 1.8B Q8_0         |     1.91 GB |            0.93 s |            2,296 MiB | No sufficiently clear quality improvement to justify the extra resident memory. Still mistranslated “idempotent”.                                                                                    |
| Qwen3.5 2B Q4_K_M        |     1.28 GB |            0.66 s |            1,646 MiB | Rejected: followed the source instruction to tell a joke, changed Tanaka to Nakamura, and reversed the meaning of a data-retention sentence.                                                         |
| TranslateGemma 4B Q4_K_M |     2.49 GB |            1.28 s |            2,775 MiB | Stronger on technical terminology and workspace membership. Added an explanation of idempotence and “treasured” to a sword that was not described that way in the source; higher memory and latency. |

An initial eight-example screen also tested HY-MT1.5 1.8B Q4_K_M and Q8_0. The older Q4 model attached “today” to attendance instead of the contact deadline. Its Q8 variant and the newer model were better on that example. Both older variants damaged the requested heading format and produced nonstandard transliterations of “idempotent”. They were not retained as defaults.

The raw 20-example outputs are in [evaluation/](evaluation/). `final.json` repeats the selected configuration with time-to-first-chunk measurements: the median was 226 ms and the maximum was 382 ms across these 20 short examples, excluding initial model loading. The alternative HY prompt asking the model to retain unfamiliar English terms did not fix “idempotent”; it was not adopted. The benchmark uses the model-specific templates embedded in the GGUF files: mandatory direction system prompt for Liquid, the full TranslateGemma translation template, non-thinking Qwen, and the published HY role delimiters. Qwen receives an explicit translation-only system instruction. Comparisons are deterministic (temperature 0); they do not measure each vendor's recommended stochastic decoding.

## Limits and failure handling

The selected model still renders “idempotent” as a nonstandard katakana term and can mistranslate context-sensitive software actions such as leaving a workspace. Deadline boundary wording can also be imprecise. The current checks **do not validate semantic correctness**. This limitation applies even when the output is fluent and looks normal.

Translations stream immediately as chunks become available. Empty output, repeated loops, token-limit truncation, damaged code/URLs, and some wrong-language outputs produce an error instead of being marked complete. Streaming text is provisional until completion; failures replace the partial result. Input is limited to 2,000 Unicode characters, context shifting is disabled, generation is bounded to 2,048 tokens and 90 seconds, and local inference is serialized. Custom prompts are not silently sent to another service; this integration does not apply them.

The installed, signed arm64 application was also checked: the settings preview delivered 14 incremental updates for “The update will not delete your files.” The first update arrived 362 ms after clicking Translate and completion arrived at 989 ms with the model already loaded. This is one UI smoke test, not a latency guarantee. The isolated settings download/cancel flow removed its partial file. Type checking, linting, and all 91 automated tests passed.

Weights remain resident while selected, including preload at application startup. Per-request contexts are disposed after use so translation history is not carried into subsequent requests. Switching away or deleting releases the weights. Previewing an unselected local model releases it after the preview finishes.

Downloads use a pinned upstream revision, exact size, and SHA-256 from Hugging Face LFS metadata. A partial file is promoted only after verification. Cancellation and failed downloads remove the partial file. The application does not convert models on the user's machine: it downloads the already-quantized GGUF to avoid a much larger full-precision download and temporary RAM/disk usage.

## Reproduce

Download a candidate GGUF outside the repository, then run:

```bash
node scripts/evaluate-local.ts /absolute/path/to/Hy-MT2-1.8B-Q4_K_M.gguf hy2
node scripts/evaluate-local.ts /absolute/path/to/LFM2-350M-ENJP-MT-Q4_K_M.gguf liquid
node scripts/evaluate-local.ts /absolute/path/to/Qwen3.5-2B-Q4_K_M.gguf qwen
node scripts/evaluate-local.ts /absolute/path/to/translategemma-4b-it.Q4_K_M.gguf gemma
npm run test:verbose
```

Model revision and hash for the shipped choice are in `src/local/model.ts`. Native inference is bundled with the application; end users do not need Python, Ollama, a compiler, or an external inference server. Package arm64 on an Apple Silicon Mac (`npx electron-builder --mac --arm64 --dir`); cross-packaging unavailable native binaries is not supported. Other platforms retain cloud translation and show offline translation as unavailable.

## Primary sources

- [Tencent Hy-MT2 model card](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF) and [technical report](https://arxiv.org/abs/2605.22064): translation-specific model family and Apache 2.0 license.
- [Tencent HY-MT1.5 model card](https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF): initial baseline and role template.
- [Liquid AI's English-Japanese model](https://huggingface.co/LiquidAI/LFM2-350M-ENJP-MT): small, direction-specific translation model.
- [Google TranslateGemma](https://huggingface.co/google/translategemma-4b-it): translation template and model description. Evaluation used the [public GGUF conversion](https://huggingface.co/mradermacher/translategemma-4b-it-GGUF), revision `35a7486e128b19642cdc72d7b91b21ba388aaf42`.
- [Unsloth Qwen3.5 GGUF](https://huggingface.co/unsloth/Qwen3.5-2B-GGUF): evaluation used revision `f6d5376be1edb4d416d56da11e5397a961aca8ae`.
- [node-llama-cpp Electron guide](https://node-llama-cpp.withcat.ai/guide/electron): native packaging and main-process execution.

## 7B model comparison

See the [M3 Air evaluation of Hy-MT2 7B and CAT-Translate](seven-billion-translation.md) for quality examples, first-text latency, memory use, and reproducible outputs. This evaluation does not change the shipped model.

## Choosing the 7B model

Settings → Model → Local / On-device offers Hy-MT2 1.8B Q4_K_M (1.13 GB download) and Hy-MT2 7B Q4_K_M (4.62 GB download). Existing 1.8B selections and downloaded files remain compatible. The 7B model uses roughly 5 GiB for inference on the tested M3 Air; 16 GB or more system RAM is recommended. Its source and license links, download status, verification and deletion are model-specific.

Only one model is resident. Switching releases the previous weights before loading the new ones. Trying an unselected model temporarily replaces the resident model, then restores the selected offline model. Both sizes stream output. The 7B role template differs from 1.8B and is selected by the fixed catalog entry.

Tencent also distributes 7B Q6_K (6.16 GB) and Q8_0 (7.98 GB). These have not been quality-tested here and are not exposed in the app. The additional memory and size do not by themselves establish a quality improvement.

## Unified model settings

Choose a provider in Settings → Model, connect an account or save its API key, then select a model. The provider list always shows connection status; “API key saved” means a key is configured, not that a request has validated it. Reasoning effort and Fast appear only for supported models. Save applies the provider, model and options together. Each model retains its own options. Translation languages and display preferences stay unchanged.

Local downloads and deletion are available in the same panel. Downloading or trying a model does not select it for normal translations. Try a translation streams output using the draft selection; saving a local model keeps that model resident. The menu bar shows the current model and opens Model Settings.
