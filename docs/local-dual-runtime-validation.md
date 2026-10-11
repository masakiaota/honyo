# 両モデルの推論経路と製品導線の検証

## 採用判断

対象はHy-MT2の1.8Bと7Bである。1.8Bをメモリ削減の対象から外す判断は、期限・中断・キャッシュ・推論backendの改善から外す判断ではない。両サイズに同じ運用契約を適用し、MLXも両方で実装・評価した。

通常のモデル選択は「1.8B · Lightweight」「7B · Higher quality」である。backendは詳細設定に分離した。明示的なサイズ変更では1.8Bは既存GGUF、7Bは検証済みMLXを候補とする。既存の保存済みIDを開くだけでは変更しない。詳細設定では両サイズともGGUF/MLXを明示選択できる。取得・保存は別操作であり、自動取得・自動移行はしない。

**1.8B MLXはExperimental, LF-onlyであり、推奨にはしない。** 全文完了は速いが、配布tokenizerの入力欠落と訳の意味の問題がある。速度だけで推奨経路を変更しない。既存GGUFにも意味や特殊表記保持の限界は残る。7B MLXは既存検証の性能・安全性を維持した。

## 共通契約

- queue・検証・ロード・warmup・生成を含む90秒期限。中断済み要求はGPU処理を開始しない。
- 指示だけをwarmupし、成功後は指示prefixだけを保持する。原文を次の要求のキャッシュに残さない。4096 context、prefill 128、最大2048 output、greedy、repetition penalty 1.05、入力2000文字を維持する。
- GGUFは中断を呼び出し元へ速やかに返すが、実処理のdrain完了まで共有context/weightsを破棄・再使用しない。解放確認が2秒で完了しない、またはcontextの破棄が失敗した場合は後続・既にqueueにある処理ともfail closedとし、再起動を要求する。
- MLXは中断・異常時にhelperを終了し、終了確認前に置換しない。無効出力・source echo・コード/URL欠落・長さ切断を成功として扱わない。生成途中の自動再試行や別backendへのfallbackは行わない。
- 常駐方針、GGUF互換性、旧モデルID、取得済みファイル、PoC資産を保持する。入力の黙った変換、追加量子化、ユーザーデータの変更は行わない。

## tokenizer検証とCRの制限

1.8Bは`mlx-community/Hy-MT2-1.8B-4bit` revision `e5c6fe56c7b3bc77fae5ae92db31f2178f1e6912`を使用する。全9 assetsをサイズ/SHA-256で固定し、重みは1,007,776,125 bytes、SHA-256 `a9cecbc77050b86b2fa3df3a8941d34ed3585cdbcce07bd64b3da289d50537c6`である。7Bの固定revisionは変更していない。

両モデルの追加特殊表記を通常文字列として符号化し、制御IDはprompt builderだけが挿入する。1.8BはBOS/User/Assistant、7BはBOS/separatorを挿入する。configのBOSとscalar/arrayのEOSをtokenizerと照合する。通常tokenizerは追加トークンを除去し、Unicode正規化を行わない。isolated regexの分割境界とByteLevel/BPEを保持し、decodeのUTF-8 byte-exact roundtripを検査する。

Rust Hugging Face tokenizers 0.23.3で生成した[参照ID fixture](../native/mlx/Tests/HonyoMlxCoreTests/Fixtures/ordinary-token-ids.json)とSwiftの出力IDを、両サイズ計12例で照合した。実tokenizerの全特殊表記、結合文字、emoji、NUL、ASCII、7BのCRLFも検査した。

**1.8Bの配布vocabularyにはbyte 13（CR）に対応する`č`がない。** Rust/Swiftとも元の設定ではCRを黙って落とす。IDの捏造やLF変換をせず、製品クライアントはhelper起動前にCRを拒否し、native側も独立に拒否する。CRLF/CR入力は既存GGUFを明示選択するか、利用者自身がLF-onlyテキストを用意する必要がある。1.8BのCR拒否を「全入力を保持できる」とは扱わない。

## 実モデルの全文完了時間

M5 Ultra Mac Studio / 96 GiB、macOS 27、Node 26.11、Xcode 27で実測した。製品クライアント、同じ短文20例・長文4例を2巡（各経路48翻訳）した。初回ロードと方向別cold compilationを除外し、指示だけのwarmup後に計測した。初回text chunk受信と全文完了を別々に記録した。1.8BはMLX→GGUFの一連の測定であり、順序反転ペアや隔離した実験ではない。通常のデスクトップ負荷がある近似値であり、他機種の保証ではない。

| 経路             | 短文完了中央値 | 長文完了中央値 | 短文first text | 長文first text |
| ---------------- | -------------: | -------------: | -------------: | -------------: |
| 1.8B GGUF Q4_K_M |      106.98 ms |     1448.50 ms |       21.77 ms |       87.07 ms |
| 1.8B MLX 4bit    |       85.57 ms |     1073.95 ms |       19.74 ms |       59.86 ms |
| 7B MLX 4bit      |      187.87 ms |     2408.75 ms |       45.80 ms |      132.35 ms |

1.8Bの全文完了は短文約20.0%、長文約25.9%短縮した。7Bは前回製品測定186.28/2396.94 msに対し約+0.9%/+0.5%であり、測定変動の範囲と考える。異なるサイズ間の速度差をbackend改善の効果とは呼ばない。

RSSは`ps`のevaluatorと子helperの合算をelapsed記録後にsampleした。MLX active allocation、Metal used、physical footprint、アプリ全体、保証されたpeakとは異なる。1.8Bのメモリ削減は本作業の採否基準にしない。以前の7B PoCの順序反転比較は[MLX runtime文書](local-mlx-runtime.md)に残し、今回の値と混同しない。

## 品質・境界・復旧

MLXの両サイズは48 fixture翻訳で実行エラー・source echo・同一入力の巡回差が0だった。2000文字の英日両方向、特殊表記のコード保存、中断と次要求での復旧も通過した。1.8BのCRは期待どおり明示拒否した。

1.8B GGUFも48 fixture翻訳と2000文字境界、中断・復旧は通過したが、追加の特殊表記コード保持probeは失敗した。評価コマンドはその失敗を記録してexit 1を返した。これを全probe成功と報告しない。通常文字列として符号化することと、生成モデルがコードをそのまま訳文に残すことは別の検査である。

AIによる原文・訳文の定性確認では、1.8B MLXにGGUFとの比較で次の意味の悪化があった。人間の品質評価や代表的benchmarkを代替しない。

- 長文index 21の「冪等」を“parallel”とした。
- 短文index 11の“Members can leave…”を「そのまま残す」とし、行為を誤った。
- 長文index 20で田中を谷田へ変更した。短文index 4には「手伝して」という不自然な形もある。

GGUFにも専門用語や文脈依存表現の誤りがある。コード/URL検査やecho検査は意味の正しさを保証しない。以上の速度利益と品質・入力制限を総合し、**1.8Bの推奨をGGUFのまま維持する**。

## 再現と配布検証

クライアント契約、保存済み4 ID、選択と明示取得、詳細設定の制限表示をunit testで検証する。`npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run test:verbose`を使用する。native testは[実行手順](local-mlx-runtime.md#再現可能な検証)に両実モデルの環境変数を指定して行う。

実モデル評価はユーザー設定を変更せず、取得済みモデルのpathを明示する。NodeのTypeScript parameter property制限を避けるため、rootで評価用bundleを作る。

    npx esbuild scripts/evaluate-mlx.ts --bundle --platform=node --format=esm --packages=external --outfile=output/native-mlx/dual-model/evaluate-local.mjs
    node output/native-mlx/dual-model/evaluate-local.mjs <verified-model-path> <helper-path> <registered-model-id>

IDsは`local-hy-mt-1.8b`（GGUF）、`local-hy-mt2-1.8b-mlx-4bit`、`local-hy-mt2-7b-q4`（GGUF）、`local-hy-mt2-7b-mlx-4bit`である。fixture pathはroot基準、必要時は`HONYO_EVALUATION_FIXTURES`で明示する。JSONLは原文・訳文を含むローカル評価成果物であり、利用者のコピー内容を投入しない。

最終検証ではVitest 22 files / 247 tests、両実tokenizerを指定したnative 10 tests（skip 0）が通過した。型・lint・format検査、production helperを含むアプリbuild、arm64 package、ad-hoc署名の`codesign --verify --deep --strict`も通過した。配布物のasar内クライアントで両MLXと1.8B GGUFの英日双方向・streaming・中断/復旧を確認し、MLXの特殊表記保持、1.8BのCR事前拒否、helper/Metal/Swift runtime/license配置も確認した。

配布asarのHTML/rendererをElectron Chromiumに読み込む隔離UI smokeも、保存済み4 IDの維持、推奨候補、詳細backend、未取得モデルの保存防止、明示取得、制限表示、変更破棄で通過した。このUI smokeはmodel APIをmockし、通常のHonyo起動や実ユーザー設定は使っていない。GGUFの既存EOS metadata警告、既存のbuild/package警告は残る。正式なDeveloper ID署名・公証、古いmacOS、Intel/universal、人間の品質保証はこの検証には含まない。生成したモデル、PoC、ログ、旧未追跡ファイルは削除しない。
