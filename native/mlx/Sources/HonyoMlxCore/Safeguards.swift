import Foundation

public struct HelperError: Error, LocalizedError, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

public enum PromptSafety {
    public static let contextSize = 4096

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
    public let text: String?

    private enum CodingKeys: String, CodingKey { case id, op, target, text }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        op = try values.decode(Operation.self, forKey: .op)
        if op == .exit {
            id = ""; target = ""; text = nil
            return
        }
        id = try values.decode(String.self, forKey: .id)
        target = try values.decode(String.self, forKey: .target)
        text = try values.decodeIfPresent(String.self, forKey: .text)
        guard !id.isEmpty, id.utf8.count <= 1024 else { throw HelperError("Invalid request id") }
        guard target == "English" || target == "Japanese" else { throw HelperError("Unsupported target") }
        if op == .translate {
            guard let text, !text.isEmpty else { throw HelperError("Translation requires nonempty text") }
        }
    }
}
