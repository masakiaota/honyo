import Foundation
import Metal
import MLX
import HonyoMlxCore

func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
          let text = String(data: data, encoding: .utf8) else { return }
    print(text)
    fflush(stdout)
}

@main
struct Helper {
    static func main() {
        signal(SIGPIPE, SIG_IGN)
        do {
            guard CommandLine.arguments.count == 2 else { throw HelperError("usage: honyo-mlx <model-dir>") }
            let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
            let binary = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.resolvingSymlinksInPath()
            let bundleURL = binary.deletingLastPathComponent().appendingPathComponent("mlx-swift_Cmlx.bundle")
            guard let bundle = Bundle(url: bundleURL),
                  let metal = bundle.url(forResource: "default", withExtension: "metallib"),
                  FileManager.default.isReadableFile(atPath: metal.path),
                  let device = MTLCreateSystemDefaultDevice() else {
                throw HelperError("Missing MLX Metal resource or device")
            }
            _ = try device.makeLibrary(URL: metal)
            GPU.metallib = metal
            // Limit reusable allocator storage; live model/KV allocations remain resident.
            Memory.cacheLimit = 256 * 1024 * 1024
            let started = Date()
            let tokenizer = try PromptTokenizer(directory: directory)
            let model = try Plamo(directory: directory)
            let decoder = FastDecoder(model: model)
            let channel = RequestChannel()
            let reader = Thread {
                while let line = readLine(strippingNewline: true) { channel.push(line) }
                channel.close()
            }
            reader.start()
            emit(["type": "ready", "protocol": 2, "modelType": "plamo3",
                  "decoder": "metal",
                  "contextSize": PromptSafety.contextSize, "loadMs": Date().timeIntervalSince(started) * 1000])
            while let line = channel.next() {
                let data = Data(line.utf8)
                let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                let id = raw?["id"] as? String ?? ""
                do {
                    let request = try JSONDecoder().decode(HelperRequest.self, from: data)
                    if request.op == .exit { return }
                    if request.op == .cancel { continue }
                    if channel.isCancelled(id) {
                        emit(["type": "cancelled", "id": id])
                        continue
                    }
                    let start = Date()
                    let full = try tokenizer.prompt(target: request.target, text: request.text ?? "Hello.")
                    let maxTokens: Int
                    do {
                        maxTokens = try PromptSafety.generationBudget(inputTokens: full.count)
                    } catch let error as PromptTooLongError {
                        // Nothing has touched the GPU yet; keep serving later requests.
                        emit(["type": "error", "id": id, "code": "input-too-long", "error": error.message])
                        continue
                    }
                    // Only weights and compiled kernels persist. Every request owns fresh KV.
                    let cache = model.newCache()
                    model.prefill(full.dropLast(), cache: cache)
                    let promptMs = Date().timeIntervalSince(start) * 1000
                    var pending = decoder.next(MLXArray([UInt32(full.last!)]), cache: cache)
                    asyncEval(pending)
                    if request.op == .warmup {
                        eval(pending)
                        emit(["type": "result", "id": id, "response": "", "stopReason": "warmup", "echoedSource": false,
                              "inputTokens": full.count, "maxTokens": 0, "outputTokens": 0,
                              "endToEndMs": Date().timeIntervalSince(start) * 1000])
                        continue
                    }
                    var output = "", incomplete: [UInt8] = []
                    var outputTokens = 0, stopReason = "length"
                    var firstTokenMs: Double?
                    let generationStart = Date()
                    for index in 0..<maxTokens {
                        if channel.isCancelled(id) { stopReason = "cancelled"; break }
                        // Encode the next GPU step before waiting for the preceding sample.
                        let current = pending
                        if index + 1 < maxTokens {
                            pending = decoder.next(current, cache: cache)
                            asyncEval(pending)
                        }
                        let token = Int(current.item(UInt32.self))
                        if tokenizer.stopIDs.contains(token) { stopReason = "stop"; break }
                        guard !tokenizer.controlIDs.contains(token) else { throw HelperError("Unexpected control output") }
                        outputTokens += 1
                        incomplete += try tokenizer.bytes(for: token)
                        if let chunk = String(bytes: incomplete, encoding: .utf8) {
                            incomplete.removeAll(keepingCapacity: true)
                            output += chunk
                            firstTokenMs = firstTokenMs ?? Date().timeIntervalSince(start) * 1000
                            emit(["type": "chunk", "id": id, "text": chunk])
                        }
                    }
                    // A speculative next step may still be writing KV. Drain it before freeing buffers.
                    eval(pending)
                    if stopReason == "cancelled" {
                        emit(["type": "cancelled", "id": id])
                        continue
                    }
                    guard incomplete.isEmpty else { throw HelperError("Incomplete UTF-8 output") }
                    let response = output.trimmingCharacters(in: .whitespacesAndNewlines)
                    emit(["type": "result", "id": id, "response": response, "stopReason": stopReason,
                          "echoedSource": response == request.text?.trimmingCharacters(in: .whitespacesAndNewlines),
                          "inputTokens": full.count, "maxTokens": maxTokens, "outputTokens": outputTokens,
                          "promptMs": promptMs, "generationMs": Date().timeIntervalSince(generationStart) * 1000,
                          "firstTokenMs": firstTokenMs ?? 0, "endToEndMs": Date().timeIntervalSince(start) * 1000])
                } catch {
                    // Termination also drains the Metal command queue and cannot reuse partial KV.
                    emit(["type": "error", "id": id, "error": error.localizedDescription])
                    exit(2)
                }
            }
        } catch {
            emit(["type": "startup-error", "error": error.localizedDescription])
            exit(3)
        }
    }
}
