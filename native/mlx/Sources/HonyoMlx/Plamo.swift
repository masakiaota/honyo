// PLaMo 3 architecture based on PFN plamo-translate-cli (Apache-2.0).
// Swift implementation uses the pinned official MLX 4-bit weights without requantizing.
import Foundation
import MLX
import HonyoMlxCore

struct PlamoConfig: Decodable {
    let modelType: String
    let hiddenSize, intermediateSize, numHiddenLayers, numAttentionHeads, numKeyValueHeads: Int
    let headDim, vocabSize, windowSize, slidingWindowPattern: Int
    let rmsNormEps, ropeScalingFactor: Float
    let tieWordEmbeddings: Bool
    let plamoRopeInvFreq: [String: [Double]]
    struct Quantization: Decodable { let bits, groupSize: Int }
    let quantization: Quantization
}

struct Projection {
    let weight: MLXArray
    let scales: MLXArray?
    let biases: MLXArray?
    let rows: Int
    let cols: Int

    init(_ name: String, rows: Int, cols: Int, quantized: Bool, weights: inout [String: MLXArray]) throws {
        guard let w = weights.removeValue(forKey: name + ".weight"),
              w.shape == [rows, quantized ? cols / 8 : cols],
              w.dtype == (quantized ? .uint32 : .float16) else { throw HelperError("Invalid \(name) weight") }
        weight = w; self.rows = rows; self.cols = cols
        if quantized {
            guard let s = weights.removeValue(forKey: name + ".scales"),
                  let b = weights.removeValue(forKey: name + ".biases"),
                  s.shape == [rows, cols / 64], b.shape == s.shape else {
                throw HelperError("Invalid \(name) quantization")
            }
            scales = s; biases = b
        } else { scales = nil; biases = nil }
    }

    func callAsFunction(_ x: MLXArray) -> MLXArray {
        if let scales { return quantizedMM(x, weight, scales: scales, biases: biases, groupSize: 64, bits: 4) }
        return matmul(x, weight.T)
    }
}

struct PlamoLayer {
    let qkv, output, gateUp, down: Projection
    let preMixer, postMixer, preMLP, postMLP, qNorm, kNorm: MLXArray
    let full: Bool
}

final class PlamoCache {
    var keys: MLXArray
    var values: MLXArray
    var offset = 0
    let capacity: Int
    let window: Bool

    init(heads: Int, capacity: Int, window: Bool) {
        self.capacity = capacity; self.window = window
        keys = MLXArray.zeros([heads, capacity, 128], dtype: .float16)
        values = MLXArray.zeros([heads, capacity, 128], dtype: .float16)
        eval(keys, values)
    }

    func update(_ k: MLXArray, _ v: MLXArray) -> (MLXArray, MLXArray) {
        let count = k.dim(1)
        if !window {
            keys[0..., offset..<(offset + count), 0...] = k
            values[0..., offset..<(offset + count), 0...] = v
            offset += count
            return (keys[0..., ..<offset, 0...], values[0..., ..<offset, 0...])
        }
        let history = min(offset, capacity - 1)
        let indices = MLXArray((offset - history..<offset).map { Int32($0 % capacity) })
        let allK = history == 0 ? k : concatenated([take(keys, indices, axis: 1), k], axis: 1)
        let allV = history == 0 ? v : concatenated([take(values, indices, axis: 1), v], axis: 1)
        let keep = min(count, capacity)
        let slots = MLXArray((offset + count - keep..<offset + count).map { Int32($0 % capacity) })
        keys[0..., slots, 0...] = k[0..., (count - keep)..., 0...]
        values[0..., slots, 0...] = v[0..., (count - keep)..., 0...]
        offset += count
        return (allK, allV)
    }
}

final class Plamo {
    let config: PlamoConfig
    let embedding: MLXArray
    let head: Projection
    let norm: MLXArray
    let layers: [PlamoLayer]
    let localRope, fullRope: MLXArray

    init(directory: URL) throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let c = try decoder.decode(PlamoConfig.self, from: Data(contentsOf: directory.appendingPathComponent("config.json")))
        guard c.modelType == "plamo3", c.headDim == 128, c.vocabSize == 107520,
              c.quantization.bits == 4, c.quantization.groupSize == 64,
              c.windowSize == 2048, c.slidingWindowPattern == 8,
              [(1536, 16, 16, 1, 6144), (2560, 24, 24, 4, 10240),
               (4096, 32, 32, 4, 16384), (5120, 64, 64, 8, 25600)].contains(where: {
                  $0 == (c.hiddenSize, c.numHiddenLayers, c.numAttentionHeads, c.numKeyValueHeads, c.intermediateSize)
              }) else { throw HelperError("Unsupported PLaMo 3 4-bit configuration") }
        config = c
        var weights: [String: MLXArray] = [:]
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "safetensors" }.sorted { $0.path < $1.path }
        guard !files.isEmpty else { throw HelperError("Missing PLaMo weights") }
        for file in files {
            let shard = try MLX.loadArrays(url: file)
            for (key, value) in shard {
                guard weights[key] == nil else { throw HelperError("Duplicate weight") }
                // The specialized kernels use FP16 activations/scales. Packed Q4 bits remain unchanged.
                let converted = value.dtype == .uint32 ? value : value.asType(.float16)
                eval(converted)
                weights[key] = converted
            }
        }
        func weight(_ key: String, shape: [Int], offset: Float = 0) throws -> MLXArray {
            guard let w = weights.removeValue(forKey: key + ".weight"), w.shape == shape else {
                throw HelperError("Missing or invalid \(key)")
            }
            return offset == 0 ? w : (w + offset).asType(.float32)
        }
        // The 31B model shares the output projection with its token embedding.
        if c.tieWordEmbeddings { weights["lm_head.weight"] = weights["model.embed_tokens.weight"] }
        embedding = try weight("model.embed_tokens", shape: [c.vocabSize, c.hiddenSize])
        head = try Projection("lm_head", rows: c.vocabSize, cols: c.hiddenSize, quantized: false, weights: &weights)
        norm = try weight("model.norm", shape: [c.hiddenSize], offset: 1)
        var loaded: [PlamoLayer] = []
        for i in 0..<c.numHiddenLayers {
            let p = "model.layers.layers.\(i)"
            loaded.append(try PlamoLayer(
                qkv: Projection(p + ".mixer.qkv_proj", rows: (c.numAttentionHeads + 2 * c.numKeyValueHeads) * 128,
                                cols: c.hiddenSize, quantized: true, weights: &weights),
                output: Projection(p + ".mixer.o_proj", rows: c.hiddenSize, cols: c.numAttentionHeads * 128,
                                   quantized: true, weights: &weights),
                gateUp: Projection(p + ".mlp.gate_up_proj", rows: c.intermediateSize * 2, cols: c.hiddenSize,
                                   quantized: true, weights: &weights),
                down: Projection(p + ".mlp.down_proj", rows: c.hiddenSize, cols: c.intermediateSize,
                                 quantized: true, weights: &weights),
                preMixer: weight(p + ".pre_mixer_norm", shape: [c.hiddenSize], offset: 1),
                postMixer: weight(p + ".post_mixer_norm", shape: [c.hiddenSize], offset: 1 / 5),
                preMLP: weight(p + ".pre_mlp_norm", shape: [c.hiddenSize], offset: 1),
                postMLP: weight(p + ".post_mlp_norm", shape: [c.hiddenSize], offset: 1 / pow(5, 1.5)),
                qNorm: weight(p + ".mixer.q_norm", shape: [128], offset: 1),
                kNorm: weight(p + ".mixer.k_norm", shape: [128], offset: 1),
                full: (i + 1) % c.slidingWindowPattern == 0))
        }
        guard weights.isEmpty else { throw HelperError("Unexpected PLaMo weights") }
        layers = loaded
        func rope(_ full: Bool) throws -> MLXArray {
            guard let inverse = c.plamoRopeInvFreq[full ? "full" : "local"],
                  inverse.count == 64, inverse.allSatisfy({ $0.isFinite && $0 > 0 }) else {
                throw HelperError("Invalid PLaMo rotary frequencies")
            }
            let scale = full ? 1 + 0.1 * log(Double(c.ropeScalingFactor)) : 1
            var table = [Float](); table.reserveCapacity(PromptSafety.contextSize * 128)
            for position in 0..<PromptSafety.contextSize {
                table += inverse.map { Float(cos(Double(position) * $0) * scale) }
                table += inverse.map { Float(sin(Double(position) * $0) * scale) }
            }
            return MLXArray(table, [PromptSafety.contextSize, 128]).asType(.float16)
        }
        localRope = try rope(false); fullRope = try rope(true)
        eval(localRope, fullRope, norm)
        for l in layers { eval(l.preMixer, l.postMixer, l.preMLP, l.postMLP, l.qNorm, l.kNorm) }
        Memory.clearCache()
    }

    func newCache() -> [PlamoCache] {
        layers.map { PlamoCache(heads: config.numKeyValueHeads,
                                capacity: $0.full ? PromptSafety.contextSize : config.windowSize,
                                window: !$0.full) }
    }

    func rms(_ x: MLXArray, _ weight: MLXArray) -> MLXArray {
        let wide = x.asType(.float32)
        let normalized = (wide * rsqrt(mean(wide * wide, axis: -1, keepDims: true) + config.rmsNormEps)).asType(.float16)
        return (normalized * weight).asType(.float16)
    }

    func rotate(_ x: MLXArray, _ table: MLXArray) -> MLXArray {
        let a = x[.ellipsis, ..<64], b = x[.ellipsis, 64...]
        let cos = table[0..., ..<64], sin = table[0..., 64...]
        // F32 products followed by one rounding matches the fused attention kernel.
        let wideA = a.asType(.float32), wideB = b.asType(.float32)
        let wideCos = cos.asType(.float32), wideSin = sin.asType(.float32)
        return concatenated([wideA * wideCos - wideB * wideSin, wideB * wideCos + wideA * wideSin], axis: -1).asType(.float16)
    }

    /// Batched prompt processing; generation uses the specialized Metal decoder.
    private func forward(_ tokens: [Int], cache: [PlamoCache]) -> MLXArray {
        let c = config, count = tokens.count
        var x = take(embedding, MLXArray(tokens.map(Int32.init)), axis: 0)
        for (l, kv) in zip(layers, cache) {
            let qDim = c.numAttentionHeads * 128, kvDim = c.numKeyValueHeads * 128
            let qkv = l.qkv(rms(x, l.preMixer))
            let q = qkv[0..., ..<qDim].reshaped(count, c.numAttentionHeads, 128).transposed(1, 0, 2)
            let k = qkv[0..., qDim..<(qDim + kvDim)].reshaped(count, c.numKeyValueHeads, 128).transposed(1, 0, 2)
            let v = qkv[0..., (qDim + kvDim)...].reshaped(count, c.numKeyValueHeads, 128).transposed(1, 0, 2)
            let table = (l.full ? fullRope : localRope)[kv.offset..<(kv.offset + count), 0...]
            let qr = rotate(rms(q, l.qNorm), table)
            let (keys, values) = kv.update(rotate(rms(k, l.kNorm), table), v)
            let n = keys.dim(1)
            let queryPositions = MLXArray(Int32(n - count)..<Int32(n)).expandedDimensions(axis: 1)
            let keyPositions = MLXArray(Int32(0)..<Int32(n)).expandedDimensions(axis: 0)
            var visible = keyPositions .<= queryPositions
            if !l.full { visible = visible .&& (keyPositions .> (queryPositions - c.windowSize)) }
            let mask = which(visible, MLXArray(Float(0)), MLXArray(-Float.infinity)).asType(.float16)
            let attended = MLXFast.scaledDotProductAttention(
                queries: qr.expandedDimensions(axis: 0), keys: keys.expandedDimensions(axis: 0),
                values: values.expandedDimensions(axis: 0), scale: 1 / sqrt(128), mask: mask)
                .squeezed(axis: 0).transposed(1, 0, 2).reshaped(count, qDim)
            x = x + rms(l.output(attended), l.postMixer)
            let gateUp = l.gateUp(rms(x, l.preMLP))
            // Compute fused SwiGLU in FP32 before the FP16 output rounding.
            let gate = gateUp[0..., ..<c.intermediateSize].asType(.float32)
            let up = gateUp[0..., c.intermediateSize...].asType(.float32)
            let hidden = (gate / (1 + exp(-gate)) * up).asType(.float16)
            x = x + rms(l.down(hidden), l.postMLP)
        }
        return x
    }

    func prefill(_ tokens: ArraySlice<Int>, cache: [PlamoCache]) {
        let input = Array(tokens)
        for start in stride(from: 0, to: input.count, by: 512) {
            let hidden = forward(Array(input[start..<min(start + 512, input.count)]), cache: cache)
            eval(hidden)
            eval(cache.flatMap { [$0.keys, $0.values] })
            Memory.clearCache()
        }
    }
}
