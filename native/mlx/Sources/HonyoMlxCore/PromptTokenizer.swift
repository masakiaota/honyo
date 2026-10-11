import Foundation
import Hub
import Tokenizers

/// swift-transformers 1.3.5 recognizes added-token spellings BEFORE applying
/// addSpecialTokens:false (which disables only post-processing). Never concatenate
/// untrusted text into the control-token tokenizer. A separate BPE instance has NO
/// added tokens, the identical ordinary vocabulary/merges, and no lossy cleanup.
/// No text escaping, substitution, Unicode normalization, or network lookup occurs.
public final class PromptTokenizer: Sendable {
    public let output: any Tokenizers.Tokenizer
    private let ordinary: any Tokenizers.Tokenizer
    public let controlIDs: Set<Int>
    public let template: String
    public let bosID: Int
    public let eosID: Int
    private let beginning: [Int]
    private let separator: Int
    private let splits: [NSRegularExpression]
    private let supportsCR: Bool

    public convenience init(directory: URL) throws {
        let config = try Data(contentsOf: directory.appendingPathComponent("tokenizer_config.json"))
        let data = try Data(contentsOf: directory.appendingPathComponent("tokenizer.json"))
        try self.init(configuration: config, tokenizerData: data)
    }

    public init(configuration: Data, tokenizerData: Data) throws {
        guard var config = try JSONSerialization.jsonObject(with: configuration) as? [NSString: Any],
              var data = try JSONSerialization.jsonObject(with: tokenizerData) as? [NSString: Any],
              let model = data["model"] as? [NSString: Any],
              model["type"] as? String == "BPE",
              let vocab = model["vocab"] as? [String: Int],
              model["merges"] is [Any],
              Self.isIdentityNormalizer(data["normalizer"]),
              let decoder = data["decoder"] as? [String: Any],
              decoder["type"] as? String == "ByteLevel",
              let added = data["added_tokens"] as? [[String: Any]], !added.isEmpty else {
            throw HelperError("Expected local Hunyuan byte-level BPE tokenizer with no normalization")
        }
        var controls: [String: Int] = [:]
        for token in added {
            guard let spelling = token["content"] as? String, let id = token["id"] as? Int else {
                throw HelperError("Malformed added token")
            }
            controls[spelling] = id
        }
        let ids = Set(controls.values)
        guard ids.count == added.count, controls.count == added.count,
              ids.isDisjoint(with: Set(vocab.values)) else {
            throw HelperError("Control tokens must be unique and separate from ordinary BPE vocabulary")
        }
        let bosSpelling = config["bos_token"] as? String
        let eosSpelling = config["eos_token"] as? String
        if bosSpelling == "<|startoftext|>", eosSpelling == "<|eos|>",
           let bos = controls[bosSpelling!], let eos = controls[eosSpelling!],
           let separator = controls["<|extra_0|>"] {
            template = "hy7"
            bosID = bos
            eosID = eos
            beginning = [bos]
            self.separator = separator
        } else if bosSpelling == "<｜hy_begin▁of▁sentence｜>",
                  eosSpelling == "<｜hy_place▁holder▁no▁2｜>",
                  let bos = controls[bosSpelling!], let eos = controls[eosSpelling!],
                  let user = controls["<｜hy_User｜>"], let assistant = controls["<｜hy_Assistant｜>"] {
            template = "hy18"
            bosID = bos
            eosID = eos
            beginning = [bos, user]
            separator = assistant
        } else {
            throw HelperError("Unsupported Hunyuan prompt token configuration")
        }
        // Select the known BPE class, avoiding strict:false stdout fallback warnings.
        config["tokenizer_class"] = "PreTrainedTokenizer"
        config["clean_up_tokenization_spaces"] = false
        output = try AutoTokenizer.from(tokenizerConfig: Config(config), tokenizerData: Config(data))
        guard let pre = data["pre_tokenizer"] as? [String: Any] else {
            throw HelperError("Missing byte-level pre-tokenizer")
        }
        let stages: [[String: Any]]
        if pre["type"] as? String == "Sequence" {
            guard let sequence = pre["pretokenizers"] as? [[String: Any]] else {
                throw HelperError("Malformed pre-tokenizer sequence")
            }
            stages = sequence
        } else { stages = [pre] }
        guard let byte = stages.last, byte["type"] as? String == "ByteLevel",
              byte["add_prefix_space"] as? Bool == false,
              byte["use_regex"] as? Bool == false else {
            throw HelperError("Unsupported byte-level pre-tokenizer")
        }
        splits = try stages.dropLast().map { stage in
            guard stage["type"] as? String == "Split", stage["behavior"] as? String == "Isolated",
                  stage["invert"] as? Bool == false,
                  let pattern = stage["pattern"] as? [String: Any], let regex = pattern["Regex"] as? String else {
                throw HelperError("Unsupported split behavior")
            }
            return try NSRegularExpression(pattern: regex)
        }
        // Preserve the configured isolated boundaries over UTF16 ranges, including
        // regex matches inside extended graphemes. ByteLevel and BPE remain upstream.
        data["added_tokens"] = [Any]()
        data["pre_tokenizer"] = byte
        supportsCR = vocab["č"] != nil
        ordinary = try AutoTokenizer.from(tokenizerConfig: Config(config), tokenizerData: Config(data))
        self.controlIDs = ids
    }

    private static func isIdentityNormalizer(_ value: Any?) -> Bool {
        if value == nil || value is NSNull { return true }
        guard let sequence = value as? [String: Any],
              sequence["type"] as? String == "Sequence",
              let normalizers = sequence["normalizers"] as? [Any] else { return false }
        return normalizers.isEmpty
    }

    public func encodeOrdinary(_ text: String) throws -> [Int] {
        // The pinned 1.8B vocabulary has no byte-13 token. Both Rust and Swift
        // silently drop CR; reject it instead of normalizing or inventing model IDs.
        if !supportsCR && text.utf8.contains(13) {
            throw HelperError("This MLX checkpoint cannot preserve CR line endings. Select GGUF or supply LF-only text.")
        }
        var pieces = [text]
        for regex in splits {
            pieces = pieces.flatMap { piece -> [String] in
                let string = piece as NSString
                var result: [String] = []
                var offset = 0
                for match in regex.matches(in: piece, range: NSRange(location: 0, length: string.length)) {
                    if match.range.location > offset {
                        result.append(string.substring(with: NSRange(location: offset, length: match.range.location - offset)))
                    }
                    if match.range.length > 0 { result.append(string.substring(with: match.range)) }
                    offset = NSMaxRange(match.range)
                }
                if offset < string.length {
                    result.append(string.substring(from: offset))
                }
                return result
            }
        }
        let ids = pieces.flatMap { ordinary.encode(text: $0, addSpecialTokens: false) }
        guard controlIDs.isDisjoint(with: Set(ids)) else {
            throw HelperError("Ordinary source encoding emitted a control token")
        }
        // Byte-exact, not Swift's canonically equivalent String == comparison.
        guard Array(ordinary.decode(tokens: ids, skipSpecialTokens: false).utf8) == Array(text.utf8) else {
            throw HelperError("Tokenizer cannot preserve source text exactly")
        }
        return ids
    }

    public func validateControlIDs(bos: Int?, eos: [Int]) throws {
        guard bos == bosID, eos.contains(eosID), !eos.isEmpty,
              Set(eos).count == eos.count, Set(eos).isSubset(of: controlIDs) else {
            throw HelperError("Model and tokenizer control IDs do not agree")
        }
    }

    public func prefix(instruction: String) throws -> [Int] {
        beginning + (try encodeOrdinary(instruction))
    }

    public func prompt(instruction: String, text: String) throws -> [Int] {
        // Encode together so ordinary BPE merges at instruction/source boundaries
        // match a cold prompt. Retention uses the CONTIGUOUS prefix, not its length.
        beginning + (try encodeOrdinary(instruction + text)) + [separator]
    }
}
