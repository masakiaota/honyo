import Foundation

/// PLaMo unigram scores and longest-prefix tie breaking match the reference.
/// Ordinary text never enters the control-token vocabulary.
public final class PromptTokenizer {
    private struct Node {
        var children: [UInt32: Int] = [:]
        var token: Int?
        var score: Int64 = 0
    }
    private var trie = [Node()]
    private var pieces: [[UInt8]] = []
    private var byteIDs = [Int](repeating: -1, count: 256)
    public private(set) var controls: [String: Int] = [:]
    public var controlIDs: Set<Int> { Set(controls.values) }
    public var stopIDs: Set<Int> { Set([controls["<|plamo:bos|>"], controls["<|plamo:tag|>"]].compactMap { $0 }) }
    private let spaces: Int
    private let repeated: Int

    public convenience init(directory: URL) throws {
        try self.init(vocabulary: Data(contentsOf: directory.appendingPathComponent("tokenizer.jsonl")),
                      configuration: Data(contentsOf: directory.appendingPathComponent("tokenizer_config.json")))
    }

    public init(vocabulary: Data, configuration: Data) throws {
        let config = try JSONSerialization.jsonObject(with: configuration) as? [String: Any]
        guard config?["tokenizer_class"] as? String == "Plamo3Tokenizer" else {
            throw HelperError("Expected Plamo3Tokenizer")
        }
        spaces = config?["break_around_consecutive_spaces_threshold"] as? Int ?? Int.max
        repeated = config?["break_around_repeated_chars_threshold"] as? Int ?? Int.max
        guard spaces >= 2, repeated >= 2, let lines = String(data: vocabulary, encoding: .utf8) else {
            throw HelperError("Invalid tokenizer configuration")
        }
        for line in lines.split(separator: "\n") {
            guard let row = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [Any],
                  row.count >= 3, let text = row[0] as? String,
                  let score = row[1] as? Double, score.isFinite, let kind = row[2] as? String else {
                throw HelperError("Invalid vocabulary entry")
            }
            let id = pieces.count
            if kind == "BYTE" {
                guard text.count == 6, text.hasPrefix("<0x"), text.hasSuffix(">"),
                      let byte = UInt8(text.dropFirst(3).dropLast(), radix: 16) else {
                    throw HelperError("Invalid byte token")
                }
                byteIDs[Int(byte)] = id
                pieces.append([byte])
            } else {
                pieces.append(Array(text.utf8))
                if kind == "CONTROL" || kind == "UNKNOWN" { controls[text] = id; continue }
                guard kind == "NORMAL", !text.isEmpty else { throw HelperError("Invalid token type") }
                var node = 0
                for scalar in text.unicodeScalars {
                    if let child = trie[node].children[scalar.value] { node = child }
                    else {
                        let child = trie.count
                        trie[node].children[scalar.value] = child
                        trie.append(Node())
                        node = child
                    }
                }
                trie[node].token = id
                trie[node].score = Int64((score * 10000).rounded(.toNearestOrEven))
            }
        }
        guard byteIDs.allSatisfy({ $0 >= 0 }),
              ["bos", "tag", "msg", "key", "val"].allSatisfy({ controls["<|plamo:\($0)|>"] != nil }) else {
            throw HelperError("Incomplete tokenizer vocabulary")
        }
    }

    public func bytes(for token: Int) throws -> [UInt8] {
        guard pieces.indices.contains(token) else { throw HelperError("Invalid generated token") }
        return pieces[token]
    }

    public func decode(_ ids: [Int]) throws -> String {
        String(decoding: try ids.flatMap { try bytes(for: $0) }, as: UTF8.self)
    }

    public func encodeOrdinary(_ text: String) throws -> [Int] {
        let chars = Array(text.unicodeScalars)
        guard !chars.isEmpty else { return [] }
        // Hard boundaries around runs prevent unigram lookahead jitter. Indices
        // avoid an inserted sentinel, preserving even literal U+EE00 byte-exactly.
        var cuts: Set<Int> = [0, chars.count]
        var start = 0
        while start < chars.count {
            var end = start + 1
            while end < chars.count && chars[end] == chars[start] { end += 1 }
            if (chars[start].value == 32 && end - start >= spaces)
                || (chars[start].value != 10 && end - start >= repeated) {
                cuts.insert(start); cuts.insert(end)
            }
            start = end
        }
        let boundaries = cuts.sorted()
        var result: [Int] = []
        for (lo, hi) in zip(boundaries, boundaries.dropFirst()) {
            var scores = [Int64](repeating: Int64.max / 4, count: hi - lo + 1)
            var lengths = [Int](repeating: 1, count: hi - lo)
            var tokens = [Int](repeating: -1, count: hi - lo)
            scores[hi - lo] = 0
            for i in stride(from: hi - 1, through: lo, by: -1) {
                let at = i - lo
                scores[at] = scores[at + 1] + 10_000_000
                var node = 0
                for j in i..<hi {
                    guard let child = trie[node].children[chars[j].value] else { break }
                    node = child
                    if let token = trie[node].token {
                        let score = scores[j + 1 - lo] - trie[node].score
                        if score < scores[at] || (score == scores[at] && j + 1 - i > lengths[at]) {
                            scores[at] = score; lengths[at] = j + 1 - i; tokens[at] = token
                        }
                    }
                }
            }
            var i = lo
            while i < hi {
                if tokens[i - lo] >= 0 { result.append(tokens[i - lo]) }
                else { result += String(chars[i]).utf8.map { byteIDs[Int($0)] } }
                i += lengths[i - lo]
            }
        }
        guard try Array(decode(result).utf8) == Array(text.utf8) else {
            throw HelperError("Tokenizer cannot preserve source text")
        }
        return result
    }

    public func prefix() throws -> [Int] {
        [controls["<|plamo:bos|>"]!, controls["<|plamo:tag|>"]!]
            + (try encodeOrdinary("dataset")) + [controls["<|plamo:msg|>"]!]
            + (try encodeOrdinary("translation"))
    }

    public func prompt(target: String, text: String) throws -> [Int] {
        guard target == "English" || target == "Japanese" else { throw HelperError("Unsupported target") }
        let tag = controls["<|plamo:tag|>"]!, msg = controls["<|plamo:msg|>"]!
        return try prefix() + [tag] + encodeOrdinary("input") + [msg] + encodeOrdinary(text)
            + [tag] + encodeOrdinary("output") + [controls["<|plamo:key|>"]!]
            + encodeOrdinary("lang") + [controls["<|plamo:val|>"]!]
            + encodeOrdinary(target == "Japanese" ? "ja" : "en") + [msg]
    }
}
