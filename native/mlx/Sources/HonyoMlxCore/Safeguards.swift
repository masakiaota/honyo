import Foundation

public struct HelperError: Error, LocalizedError, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// The prompt does not fit the fixed context. Thrown before any GPU work, so the helper
/// can reject the request and keep serving the next one.
public struct PromptTooLongError: Error, LocalizedError, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

public enum PromptSafety {
    public static let contextSize = 4096

    public static func generationBudget(inputTokens: Int) throws -> Int {
        guard inputTokens > 0, inputTokens <= contextSize else {
            throw PromptTooLongError("Prompt exceeds fixed 4096-token context")
        }
        let budget = min(2048, contextSize - inputTokens - 16)
        guard budget >= 512 else { throw PromptTooLongError("Insufficient translation budget (minimum 512 tokens)") }
        return budget
    }
}

public struct HelperRequest: Decodable, Sendable {
    public enum Operation: String, Decodable, Sendable { case warmup, translate, cancel, exit }
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
        guard !id.isEmpty, id.utf8.count <= 1024 else { throw HelperError("Invalid request id") }
        if op == .cancel {
            target = ""; text = nil
            return
        }
        target = try values.decode(String.self, forKey: .target)
        text = try values.decodeIfPresent(String.self, forKey: .text)
        guard target == "English" || target == "Japanese" else { throw HelperError("Unsupported target") }
        if op == .translate {
            guard let text, !text.isEmpty else { throw HelperError("Translation requires nonempty text") }
        }
    }
}

/// Request lines read on a background thread so that a cancel frame can reach a running
/// generation. Only the most recent cancel id is kept; ids are unique per request.
public final class RequestChannel: @unchecked Sendable {
    private let lock = NSCondition()
    private var queue: [String] = []
    private var closed = false
    private var cancelledID: String?

    public init() {}

    /// Called by the reader. Cancel frames are applied immediately instead of being queued.
    public func push(_ line: String) {
        let request = try? JSONDecoder().decode(HelperRequest.self, from: Data(line.utf8))
        lock.lock()
        defer { lock.unlock() }
        if request?.op == .cancel, let id = request?.id {
            cancelledID = id
            return
        }
        queue.append(line)
        lock.signal()
    }

    public func close() {
        lock.lock()
        closed = true
        lock.broadcast()
        lock.unlock()
    }

    /// Blocks until the next request line, or nil after the input closed.
    public func next() -> String? {
        lock.lock()
        defer { lock.unlock() }
        while queue.isEmpty && !closed { lock.wait() }
        return queue.isEmpty ? nil : queue.removeFirst()
    }

    public func isCancelled(_ id: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return !id.isEmpty && cancelledID == id
    }
}
