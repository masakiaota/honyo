import Foundation

public struct HelperError: Error, LocalizedError, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

public enum PromptSafety {
    public static let contextSize = 4096

    /// Never count equal tokens after the first mismatch.
    public static func commonPrefix(_ left: [Int], _ right: [Int]) -> Int {
        var count = 0
        for (a, b) in zip(left, right) {
            if a != b { break }
            count += 1
        }
        return count
    }

    /// Metadata must never claim tokens not present in EVERY layer's actual KV.
    public static func retainedCount(prefix: [Int], prompt: [Int], offsets: [Int]) -> Int {
        min(commonPrefix(prefix, prompt), max(0, offsets.min() ?? 0))
    }

    public static func generationBudget(inputTokens: Int) throws -> Int {
        guard inputTokens > 0, inputTokens <= contextSize else {
            throw HelperError("Prompt exceeds fixed 4096-token context")
        }
        let budget = min(2048, contextSize - inputTokens - 16)
        guard budget >= 512 else { throw HelperError("Insufficient translation budget (minimum 512 tokens)") }
        return budget
    }
}

public struct HelperRequest: Decodable, Sendable {
    public enum Operation: String, Decodable, Sendable { case warmup, translate, exit }
    public let id: String
    public let op: Operation
    public let target: String
    public let instruction: String
    public let text: String?

    private enum CodingKeys: String, CodingKey { case id, op, target, instruction, text }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        op = try values.decode(Operation.self, forKey: .op)
        if op == .exit {
            id = ""; target = ""; instruction = ""; text = nil
            return
        }
        id = try values.decode(String.self, forKey: .id)
        target = try values.decode(String.self, forKey: .target)
        instruction = try values.decode(String.self, forKey: .instruction)
        text = try values.decodeIfPresent(String.self, forKey: .text)
        guard !id.isEmpty, id.utf8.count <= 1024 else { throw HelperError("Invalid request id") }
        guard target == "English" || target == "Japanese" else { throw HelperError("Unsupported target") }
        guard !instruction.isEmpty, instruction.utf8.count <= 65536 else { throw HelperError("Invalid instruction") }
        if op == .translate {
            guard let text, !text.isEmpty else { throw HelperError("Translation requires nonempty text") }
        }
    }
}
