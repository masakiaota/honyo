import Foundation
import Darwin
import Metal
import HonyoMlxCore
import MLX
import MLXLLM
import MLXLMCommon

struct LocalTokenizerLoader: TokenizerLoader {
    let prompt: PromptTokenizer
    func load(from directory: URL) async throws -> any MLXLMCommon.Tokenizer {
        LocalTokenizer(prompt: prompt)
    }
}

struct LocalTokenizer: MLXLMCommon.Tokenizer {
    let prompt: PromptTokenizer
    func encode(text: String, addSpecialTokens: Bool) -> [Int] {
        prompt.output.encode(text: text, addSpecialTokens: addSpecialTokens)
    }
    func decode(tokenIds: [Int], skipSpecialTokens: Bool) -> String {
        prompt.output.decode(tokens: tokenIds, skipSpecialTokens: skipSpecialTokens)
    }
    func convertTokenToId(_ token: String) -> Int? { prompt.output.convertTokenToId(token) }
    func convertIdToToken(_ id: Int) -> String? { prompt.output.convertIdToToken(id) }
    var bosToken: String? { prompt.output.bosToken }
    var eosToken: String? { prompt.output.eosToken }
    var unknownToken: String? { prompt.output.unknownToken }
    func applyChatTemplate(messages: [[String: any Sendable]], tools: [[String: any Sendable]]?,
                           additionalContext: [String: any Sendable]?) throws -> [Int] {
        throw MLXLMCommon.TokenizerError.missingChatTemplate
    }
}

/// stdout is reserved exclusively for protocol JSONL, including launch errors.
func emit(_ object: [String: Any]) {
    do {
        var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        data.append(0x0a)
        try FileHandle.standardOutput.write(contentsOf: data)
    } catch {
        // Broken IPC is terminal; Node owns abort/timeout and process respawning.
        exit(4)
    }
}

/// Only touched inside the model container's sequential perform closure.
final class Resident: @unchecked Sendable {
    var cache: [KVCache] = []
    var keptPrefix: [Int] = []

    func reset() { cache = []; keptPrefix = [] }

    /// Every layer must be rewindable and agree on the resulting offset. If any
    /// layer fails to trim, throw away the whole cache rather than trusting metadata.
    func rewind(to count: Int) -> Bool {
        guard !cache.isEmpty else { return count == 0 }
        for layer in cache {
            guard layer.offset >= count, layer.isTrimmable else { reset(); return false }
            if layer.offset > count { layer.trim(layer.offset - count) }
        }
        guard cache.allSatisfy({ $0.offset == count }) else { reset(); return false }
        MLX.eval(cache.flatMap { $0.state })
        return true
    }

    func prepare(prompt: [Int], context: ModelContext) throws -> Int {
        if cache.isEmpty { cache = try context.model.newCache(parameters: nil) }
        let common = PromptSafety.retainedCount(
            prefix: keptPrefix, prompt: prompt, offsets: cache.map { $0.offset })
        if !rewind(to: common) {
            cache = try context.model.newCache(parameters: nil)
            return 0
        }
        return common
    }

    func retain(prefix: [Int], prompt: [Int]) -> Int {
        let count = PromptSafety.retainedCount(
            prefix: prefix, prompt: prompt, offsets: cache.map { $0.offset })
        guard rewind(to: count) else { return 0 }
        keptPrefix = Array(prompt.prefix(count))
        return count
    }
}

@main
struct Helper {
    static func main() async {
        // Writing to a closed pipe must not introduce non-JSON stdout or hang.
        signal(SIGPIPE, SIG_IGN)
        do {
            guard CommandLine.arguments.count == 2 else {
                throw HelperError("usage: honyo-mlx <model-dir>")
            }
            let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
            let configData = try Data(contentsOf: directory.appendingPathComponent("config.json"))
            guard let config = try JSONSerialization.jsonObject(with: configData) as? [String: Any],
                  config["model_type"] as? String == "hunyuan_v1_dense" else {
                throw HelperError("Only local hunyuan_v1_dense checkpoints are supported")
            }
            let binary = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.resolvingSymlinksInPath()
            let bundleURL = binary.deletingLastPathComponent().appendingPathComponent("mlx-swift_Cmlx.bundle")
            guard let bundle = Bundle(url: bundleURL),
                  let metal = bundle.url(forResource: "default", withExtension: "metallib"),
                  FileManager.default.isReadableFile(atPath: metal.path),
                  let device = MTLCreateSystemDefaultDevice() else {
                throw HelperError("Missing sibling mlx-swift_Cmlx.bundle/default.metallib or Metal device")
            }
            // Validate the actual resource, and select it explicitly. Do not fall back
            // to a developer DerivedData path embedded in a dependency binary.
            _ = try device.makeLibrary(URL: metal)
            GPU.metallib = metal
            let started = Date()
            let promptTokenizer = try PromptTokenizer(directory: directory)
            let container = try await LLMModelFactory.shared.loadContainer(
                from: directory, using: LocalTokenizerLoader(prompt: promptTokenizer))
            emit(["type": "ready", "protocol": 1, "modelType": "hunyuan_v1_dense",
                  "contextSize": PromptSafety.contextSize, "loadMs": Date().timeIntervalSince(started) * 1000])
            let resident = Resident()
            await container.perform { context in
                while let line = readLine(strippingNewline: true) {
                    let data = Data(line.utf8)
                    let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                    let id = raw?["id"] as? String ?? ""
                    do {
                        let request = try JSONDecoder().decode(HelperRequest.self, from: data)
                        if request.op == .exit { break }
                        let start = Date()
                        let prefix = try promptTokenizer.prefix(instruction: request.instruction)
                        if request.op == .warmup {
                            guard prefix.count <= PromptSafety.contextSize - 16 else {
                                throw HelperError("Instruction exceeds fixed context")
                            }
                            let common = try resident.prepare(prompt: prefix, context: context)
                            if common < prefix.count {
                                // Direct forward passes ONLY. No TokenIterator, sampler,
                                // generation, source text, separator, or output tokens.
                                let suffix = Array(prefix.dropFirst(common))
                                for begin in stride(from: 0, to: suffix.count, by: 128) {
                                    let tokens = MLXArray(Array(suffix[begin..<min(begin + 128, suffix.count)]))[.newAxis]
                                    let logits = context.model(tokens, cache: resident.cache)
                                    MLX.eval(logits, resident.cache.flatMap { $0.state })
                                }
                            }
                            let kept = resident.retain(prefix: prefix, prompt: prefix)
                            emit(["type": "result", "id": request.id, "response": "", "stopReason": "warmup",
                                  "echoedSource": false, "inputTokens": prefix.count, "maxTokens": 0,
                                  "outputTokens": 0, "cachedPrefixTokens": kept,
                                  "endToEndMs": Date().timeIntervalSince(start) * 1000])
                            continue
                        }
                        let source = request.text!
                        let full = try promptTokenizer.prompt(instruction: request.instruction, text: source)
                        let maxTokens = try PromptSafety.generationBudget(inputTokens: full.count)
                        let common = try resident.prepare(prompt: full, context: context)
                        guard common < full.count else { throw HelperError("No uncached translation prompt") }
                        var parameters = GenerateParameters()
                        parameters.maxTokens = maxTokens
                        parameters.temperature = 0
                        parameters.repetitionPenalty = 1.05
                        parameters.repetitionContextSize = 64
                        parameters.prefill.stepSize = 128
                        var output = ""
                        var stopReason = "unknown"
                        var completed = false
                        var outputTokens = 0
                        var firstTokenMs: Double?
                        var promptMs = 0.0
                        var generationMs = 0.0
                        for try await event in try generate(
                            input: LMInput(tokens: MLXArray(Array(full.dropFirst(common)))),
                            cache: resident.cache, parameters: parameters, context: context) {
                            if let chunk = event.chunk {
                                firstTokenMs = firstTokenMs ?? Date().timeIntervalSince(start) * 1000
                                output += chunk
                                emit(["type": "chunk", "id": request.id, "text": chunk])
                            }
                            if let info = event.info {
                                completed = true
                                stopReason = "\(info.stopReason)"
                                outputTokens = info.generationTokenCount
                                promptMs = info.promptTime * 1000
                                generationMs = info.generateTime * 1000
                            }
                        }
                        guard completed else { throw HelperError("Generation ended without completion metadata") }
                        let kept = resident.retain(prefix: prefix, prompt: full)
                        let response = output.trimmingCharacters(in: .whitespacesAndNewlines)
                        let echoed = response == source.trimmingCharacters(in: .whitespacesAndNewlines)
                        emit(["type": "result", "id": request.id, "response": response,
                              "stopReason": stopReason, "echoedSource": echoed,
                              "inputTokens": full.count, "maxTokens": maxTokens, "outputTokens": outputTokens,
                              "cachedPrefixTokens": kept, "reusedPrefixTokens": common,
                              "firstTokenMs": firstTokenMs ?? -1, "promptTimeMs": promptMs,
                              "generateTimeMs": generationMs, "endToEndMs": Date().timeIntervalSince(start) * 1000])
                    } catch {
                        resident.reset()
                        emit(["type": "error", "id": id, "error": error.localizedDescription])
                    }
                }
            }
        } catch {
            emit(["type": "startup-error", "error": error.localizedDescription])
            exit(3)
        }
    }
}
