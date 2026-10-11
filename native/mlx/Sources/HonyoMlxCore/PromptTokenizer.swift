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
    private let bos: Int
    private let separator: Int

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
              data["normalizer"] == nil || data["normalizer"] is NSNull,
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
        guard ids.isDisjoint(with: Set(vocab.values)),
              let bos = controls["<|startoftext|>"], let separator = controls["<|extra_0|>"],
              controls["<|eos|>"] != nil else {
            throw HelperError("Control tokens must be separate from ordinary BPE vocabulary")
        }
        // Select the known BPE class, avoiding strict:false stdout fallback warnings.
        config["tokenizer_class"] = "PreTrainedTokenizer"
        config["clean_up_tokenization_spaces"] = false
        output = try AutoTokenizer.from(tokenizerConfig: Config(config), tokenizerData: Config(data))
        data["added_tokens"] = [Any]()
        ordinary = try AutoTokenizer.from(tokenizerConfig: Config(config), tokenizerData: Config(data))
        self.controlIDs = ids
        self.bos = bos
        self.separator = separator
    }

    public func encodeOrdinary(_ text: String) throws -> [Int] {
        let ids = ordinary.encode(text: text, addSpecialTokens: false)
        guard controlIDs.isDisjoint(with: Set(ids)) else {
            throw HelperError("Ordinary source encoding emitted a control token")
        }
        // Byte-exact, not Swift's canonically equivalent String == comparison.
        guard Array(ordinary.decode(tokens: ids, skipSpecialTokens: false).utf8) == Array(text.utf8) else {
            throw HelperError("Tokenizer cannot preserve source text exactly")
        }
        return ids
    }

    public func prefix(instruction: String) throws -> [Int] {
        [bos] + (try encodeOrdinary(instruction))
    }

    public func prompt(instruction: String, text: String) throws -> [Int] {
        // Encode together so ordinary BPE merges at instruction/source boundaries
        // match a cold prompt. Retention uses the CONTIGUOUS prefix, not its length.
        [bos] + (try encodeOrdinary(instruction + text)) + [separator]
    }
}
