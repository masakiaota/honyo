# Honyo PLaMo MLX helper

The bundled Swift executable serves PLaMo 3 Translate 0.8B, 2B, 8B and 31B,
using official MLX 4-bit weights and specialized Metal decode kernels.
It needs no Python runtime, service or network connection.

Build from the repository root with `npm run build:mlx`. Full Xcode,
Swift 6.2+ and the Metal Toolchain are required. The executable and its sibling
`mlx-swift_Cmlx.bundle` must remain together. Package pins are in `Package.resolved`;
build output is staged in `build/mlx/`.

See [the architecture and validation guide](../../docs/local-mlx-runtime.md)
for model manifests, lifecycle rules, limits and evaluation commands.

## JSONL contract

Start `honyo-mlx <model-directory>`. Standard output is reserved for protocol frames.
After loading, the helper emits `ready` with protocol `1`, model type `plamo3`,
decoder `metal`, context size and load duration.

Requests have a unique string `id`, `op` (`warmup` or `translate`) and `target`
(`English` or `Japanese`). Translation also requires nonempty `text`.
The helper builds PFML3 itself; callers do not supply model instructions.
An `exit` request terminates the process.

Translation emits incremental `chunk` frames followed by one `result`. Results
contain `response`, `stopReason`, `echoedSource`, `inputTokens`, `maxTokens`,
`outputTokens` and timing measurements. Warmup returns an empty response with
`stopReason: "warmup"` and zero generation budget/count.

Errors emit `startup-error` or `error` and terminate. The Node client owns the
deadline, output bounds, cancellation and confirmed shutdown barrier.
Each request gets fresh KV buffers. Pending GPU work is drained before buffers
are released, including the speculative step after the final token.

## Upstream attribution

The model architecture and Metal sources were adapted from
[PFN plamo-translate-cli at 82788925](https://github.com/pfnet/plamo-translate-cli/tree/82788925ce64b5ec15abb25a650ccf4616eff57a/src/plamo_translate/servers/mlx),
under Apache-2.0. The port uses Swift, accepts the official prequantized checkpoints,
keeps their dense output head, uses fixed context capacities, and supports the
head ratios of all four sizes. The license is in `Licenses/PlamoMetal.txt` and is
included in packaged artifacts. Model weights have their separate PLaMo license.
