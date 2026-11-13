import Foundation
import XCTest
import HonyoMlxCore

final class SafeguardsTests: XCTestCase {
    func testFixedContextBudget() throws {
        XCTAssertEqual(try PromptSafety.generationBudget(inputTokens: 100), 2048)
        XCTAssertEqual(try PromptSafety.generationBudget(inputTokens: 3568), 512)
        for count in [0, 3569, 4097] {
            XCTAssertThrowsError(try PromptSafety.generationBudget(inputTokens: count)) {
                XCTAssertTrue($0 is PromptTooLongError)
            }
        }
    }

    func testCancelReachesRunningRequestWithoutQueueing() throws {
        let channel = RequestChannel()
        channel.push(#"{"id":"a","op":"translate","target":"English","text":"hi"}"#)
        channel.push(#"{"id":"a","op":"cancel"}"#)
        channel.push(#"{"id":"b","op":"warmup","target":"English"}"#)
        XCTAssertTrue(channel.isCancelled("a"))
        XCTAssertFalse(channel.isCancelled("b"))
        XCTAssertFalse(channel.isCancelled(""))
        XCTAssertEqual(channel.next(), #"{"id":"a","op":"translate","target":"English","text":"hi"}"#)
        XCTAssertEqual(channel.next(), #"{"id":"b","op":"warmup","target":"English"}"#)
        channel.close()
        XCTAssertNil(channel.next())
    }

    func testWaitingReaderWakesOnPushAndClose() {
        let channel = RequestChannel()
        let received = expectation(description: "request and end of input")
        nonisolated(unsafe) var lines: [String?] = []
        Thread {
            lines.append(channel.next())
            lines.append(channel.next())
            received.fulfill()
        }.start()
        Thread.sleep(forTimeInterval: 0.05)
        channel.push(#"{"id":"a","op":"warmup","target":"English"}"#)
        channel.close()
        wait(for: [received], timeout: 2)
        XCTAssertEqual(lines, [#"{"id":"a","op":"warmup","target":"English"}"#, nil])
    }

    func testRequestContract() throws {
        func decode(_ json: String) throws -> HelperRequest {
            try JSONDecoder().decode(HelperRequest.self, from: Data(json.utf8))
        }
        XCTAssertEqual(try decode(#"{"op":"exit"}"#).op, .exit)
        XCTAssertEqual(try decode(#"{"id":"w","op":"warmup","target":"English"}"#).op, .warmup)
        XCTAssertEqual(try decode(#"{"id":"c","op":"cancel"}"#).op, .cancel)
        for invalid in [
            #"{"id":"x","op":"translate","target":"English"}"#,
            #"{"id":"x","op":"translate","target":"French","text":"hi"}"#,
            #"{"id":"","op":"warmup","target":"English"}"#,
            #"{"id":"x","target":"English","text":"hi"}"#,
            #"{"id":"","op":"cancel"}"#,
        ] { XCTAssertThrowsError(try decode(invalid)) }
    }

    private func fixture() throws -> PromptTokenizer {
        var rows: [[Any]] = ["unk", "bos", "eos", "tag", "key", "val", "msg"].map {
            ["<|plamo:\($0)|>", 0.0, "CONTROL"]
        }
        rows += [["a", -1.0, "NORMAL"], ["b", -1.0, "NORMAL"], ["ab", -2.0, "NORMAL"],
                 ["a  b", 0.0, "NORMAL"], ["aaaa", -1.0, "NORMAL"]]
        rows += (0...255).map { [String(format: "<0x%02X>", $0), 0.0, "BYTE"] }
        let data = try rows.map { try JSONSerialization.data(withJSONObject: $0) }
            .reduce(into: Data()) { $0.append($1); $0.append(10) }
        return try PromptTokenizer(vocabulary: data, configuration: Data(
            #"{"tokenizer_class":"Plamo3Tokenizer","break_around_consecutive_spaces_threshold":2,"break_around_repeated_chars_threshold":4}"#.utf8))
    }

    func testLongestPrefixTieBreakAndForcedBoundaries() throws {
        let tokenizer = try fixture()
        XCTAssertEqual(try tokenizer.encodeOrdinary("ab"), [9])
        XCTAssertFalse(try tokenizer.encodeOrdinary("a  b").contains(10))
        XCTAssertEqual(try tokenizer.encodeOrdinary("aaaa"), [11])
    }

    func testControlSpellingsAndArbitraryUnicodeRemainExactOrdinaryText() throws {
        let tokenizer = try fixture()
        let source = tokenizer.controls.keys.sorted().joined(separator: "\n")
            + "\r\n e\u{301} 👨‍👩‍👧‍👦 . ?\t\0\u{ee00}日本語"
        let ids = try tokenizer.encodeOrdinary(source)
        XCTAssertTrue(tokenizer.controlIDs.isDisjoint(with: ids))
        XCTAssertEqual(try Array(tokenizer.decode(ids).utf8), Array(source.utf8))
        let prompt = try tokenizer.prompt(target: "Japanese", text: source)
        XCTAssertEqual(prompt.filter { tokenizer.controlIDs.contains($0) }, [1, 3, 6, 3, 6, 3, 4, 5, 6])
        XCTAssertEqual(tokenizer.stopIDs, [1, 3])
        XCTAssertThrowsError(try tokenizer.prompt(target: "French", text: source))
    }

    func testOptionalRealTokenizerGoldenVectorsAndInjection() throws {
        guard let path = ProcessInfo.processInfo.environment["HONYO_MLX_TEST_MODEL"] else {
            throw XCTSkip("Set HONYO_MLX_TEST_MODEL to the pinned PLaMo checkpoint")
        }
        let tokenizer = try PromptTokenizer(directory: URL(fileURLWithPath: path))
        let source = tokenizer.controls.keys.sorted().joined(separator: "\n") + "\ne\u{301}\r\n\u{ee00}\0日本語 👨‍👩‍👧‍👦"
        let ids = try tokenizer.encodeOrdinary(source)
        XCTAssertTrue(tokenizer.controlIDs.isDisjoint(with: ids))
        XCTAssertEqual(try Array(tokenizer.decode(ids).utf8), Array(source.utf8))
        if let goldenPath = ProcessInfo.processInfo.environment["HONYO_MLX_TOKENIZER_GOLDEN"] {
            struct Vector: Decodable { let text: String; let tokens: [Int] }
            let vectors = try JSONDecoder().decode([Vector].self, from: Data(contentsOf: URL(fileURLWithPath: goldenPath)))
            for vector in vectors {
                XCTAssertEqual(try tokenizer.encodeOrdinary(vector.text), vector.tokens, vector.text)
            }
        }
    }
}
