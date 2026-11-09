// Adapted from PFN plamo-translate-cli (Apache-2.0); see licenses/PlamoMetal.txt.
// Modified for Swift and all four query/KV head ratios. Seven dispatches per layer.
import Foundation
import MLX
import HonyoMlxCore

final class FastDecoder {
    private let model: Plamo
    private let qmv, denseMV, gate, norm, embed, attention: MLXFast.MLXFastKernel

    init(model: Plamo) {
        self.model = model
        let constants = "constant float eps = \(model.config.rmsNormEps)f;\nconstant float attention_scale = \(1 / sqrt(Float(128)))f;\n"
        qmv = MLXFast.metalKernel(name: "plamo_qmv", inputNames: ["w", "scales", "biases", "x"],
                                 outputNames: ["y"], source: MetalSources.qmv, header: MetalSources.qdot)
        denseMV = MLXFast.metalKernel(name: "plamo_dense_mv", inputNames: ["w", "x"],
                                     outputNames: ["y"], source: MetalSources.denseMV, header: MetalSources.denseDot)
        gate = MLXFast.metalKernel(name: "plamo_gate", inputNames: ["w", "scales", "biases", "x"],
                                  outputNames: ["y"], source: MetalSources.gate, header: MetalSources.qdot)
        norm = MLXFast.metalKernel(name: "plamo_norm", inputNames: ["a", "b", "wa", "wb"],
                                  outputNames: ["r", "normed"], source: MetalSources.norm, header: constants)
        embed = MLXFast.metalKernel(name: "plamo_embed", inputNames: ["table", "token", "wb"],
                                   outputNames: ["r", "normed"], source: MetalSources.embed, header: constants)
        attention = MLXFast.metalKernel(name: "plamo_attention",
                                       inputNames: ["qkv", "keys", "values", "rope", "params", "q_weight", "k_weight"],
                                       outputNames: ["out"], source: MetalSources.attention, header: constants)
    }

    private func mv(_ p: Projection, _ x: MLXArray, gated: Bool = false, dtype: DType = .float16) -> MLXArray {
        var template: [(String, any KernelTemplateArg)] = [("T", DType.float16), ("Y", dtype), ("cols", p.cols)]
        let rows = gated ? p.rows / 2 : p.rows
        if gated { template.append(("half_rows", rows)) }
        let inputs: [MLXArray]
        let kernel: MLXFast.MLXFastKernel
        if let scales = p.scales, let biases = p.biases {
            inputs = [p.weight, scales, biases, x]; kernel = gated ? gate : qmv
        } else { inputs = [p.weight, x]; kernel = denseMV }
        return kernel(inputs, template: template, grid: (rows / 8 * 64, 1, 1), threadGroup: (64, 1, 1),
                      outputShapes: [[rows]], outputDTypes: [dtype])[0]
    }

    private func pair(_ a: MLXArray, _ b: MLXArray, _ wa: MLXArray, _ wb: MLXArray) -> [MLXArray] {
        norm([a, b, wa, wb], template: [("T", DType.float16), ("n", model.config.hiddenSize), ("groups", 16)],
             grid: (512, 1, 1), threadGroup: (512, 1, 1),
             outputShapes: [[model.config.hiddenSize], [model.config.hiddenSize]], outputDTypes: [.float16, .float16])
    }

    func logits(_ token: MLXArray, cache: [PlamoCache]) -> MLXArray {
        let c = model.config, n = c.hiddenSize, position = cache[0].offset
        precondition(position < PromptSafety.contextSize)
        var pair = embed([model.embedding, token, model.layers[0].preMixer],
                         template: [("T", DType.float16), ("n", n), ("groups", 16)],
                         grid: (512, 1, 1), threadGroup: (512, 1, 1),
                         outputShapes: [[n], [n]], outputDTypes: [.float16, .float16])
        for (i, l) in model.layers.enumerated() {
            let kv = cache[i]
            let params = MLXArray([UInt32(position), UInt32(position % kv.capacity),
                                   UInt32(min(position, kv.capacity)), UInt32(kv.capacity)])
            let qkv = mv(l.qkv, pair[1])
            let attended = attention(
                [qkv, kv.keys, kv.values, l.full ? model.fullRope : model.localRope, params, l.qNorm, l.kNorm],
                template: [("T", DType.float16), ("groups", 32), ("head_ratio", c.numAttentionHeads / c.numKeyValueHeads),
                           ("q_dim", c.numAttentionHeads * 128), ("kv_dim", c.numKeyValueHeads * 128)],
                grid: (1024 * c.numAttentionHeads, 1, 1), threadGroup: (1024, 1, 1),
                outputShapes: [[c.numAttentionHeads * 128]], outputDTypes: [.float16])[0]
            kv.offset += 1
            pair = self.pair(mv(l.output, attended), pair[0], l.postMixer, l.preMLP)
            let hidden = mv(l.gateUp, pair[1], gated: true)
            let following = i + 1 < model.layers.count ? model.layers[i + 1].preMixer : model.norm
            pair = self.pair(mv(l.down, hidden), pair[0], l.postMLP, following)
        }
        return mv(model.head, pair[1], dtype: .float32)
    }

    func next(_ token: MLXArray, cache: [PlamoCache]) -> MLXArray {
        argMax(logits(token, cache: cache), keepDims: true).asType(.uint32)
    }

}
