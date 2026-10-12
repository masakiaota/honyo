# 7B Swift MLXオフライン翻訳

## 目的と採用範囲

Apple Silicon Macの7B翻訳について、常駐モデルの応答速度と安全な運用を改善する。Pythonの常駐や追加サービスへの接続ではなく、Electron/Nodeから同梱Swift helperを直接起動する。軽量な1.8Bは既存GGUFを使用する。

設定のローカルモデルは「1.8B · Lightweight」と「7B · Higher quality」の2つだけである。1.8BはGGUF Q4_K_M、7BはSwift MLX 4-bitに固定し、Advanced/backend選択は設けない。7B GGUFと1.8B MLXの登録・ダウンロード定義は撤去し、旧IDの互換aliasも残さない。旧IDが保存されている場合は現在のモデルを明示選択する。既存の取得済みファイルは自動削除しない。1.8B MLXの実験と不採用理由は[検証記録](local-dual-runtime-validation.md)に残す。GGUFはnode-llama-cpp/llama.cpp Metalで動く。

Q3 GGUFは別の省メモリ候補であるが、この実装では配布メタデータに問題のある第三者Q3チェックポイントを製品へ追加しない。Q3とMLXの研究上の採否は別問題である。

## 実行・保存

- Nodeが`honyo-mlx <model-dir>`をshellなしで起動し、JSONLで翻訳する。同一モデルは常駐し、推論を直列化する。アイドル解放や段階的解放は行わない。
- コンテキストは4096 tokens。出力上限は`min(2048, 4096 - inputTokens - 16)`、最低512 tokensを確保する。入力上限2000文字と既存の英日判定・コード/URL保存検査を維持する。
- ウォームアップは翻訳指示だけのforward passであり、翻訳文を生成しない。正常終了後は全KV層から原文・出力を除き、実際の評価済みオフセットで制限した連続指示prefixだけを保持する。
- 原文に含まれる特殊トークン表記は、追加トークンを持たない同一BPEで通常文字列として符号化する。制御IDはprompt builderだけが挿入する。Unicodeを正規化・置換せず、UTF-8 byte-exact roundtripも検証する。
- 1要求の90秒期限はqueue、起動、ロード、生成を含む。中断、異常終了、不正protocol、無効出力ではhelperを破棄する。生成途中の自動再試行はせず、次の独立した要求で再起動する。
- 解放時は終了確認後にのみ別モデルを起動する。SIGTERMの後1秒でSIGKILL、さらに終了を確認できなければ置換を拒否し、アプリ再起動を要求する。二重常駐を許さない。
- stdoutはprotocol専用。Nodeは行長、出力、frame数を制限し、raw helper error、stderr、原文をアプリのエラーやログへ出さない。

7Bモデルは`mlx-community/Hy-MT2-7B-4bit`のrevision `9b7204bdb161490a8ce49ce607c1310cc3fd03ad`。過去の1.8B MLX実験のrevisionと制限は[検証記録](local-dual-runtime-validation.md)を参照する。製品から1.8B MLXを取得する定義はない。重み、tokenizer、設定、LICENSE等の各assetについてサイズとSHA-256を固定する。全assetの取得・検証後だけ一時ディレクトリから昇格する。破損、不足、中断では不完全モデルを使用せず、別のモデルのファイルを削除しない。モデル選択後の翻訳はネットワークもPythonも不要である。

モデル重みをアプリ配布物へ入れず、従来どおり設定画面から取得する。LICENSEを同じ固定revisionからダウンロードし、設定のライセンスリンクもそのrevisionへ向ける。

## ビルドと配布

`npm run build`はmacOS arm64でアプリビルド後に`npm run build:mlx`を実行する。Swift依存はMLX Swift LM 3.32.3 / swift-transformers 1.3.5とlockfileで固定する。完全なXcode、Swift 6.2以上、Metal Toolchainが開発時に必要である。モデルやPythonの導入はビルドに不要。

生成物は`build/mlx/`。helper、`mlx-swift_Cmlx.bundle/Contents/Resources/default.metallib`および必要なSwift互換dylibを一緒に扱う。macOSパッケージでは`Contents/Resources/mlx/`へasar外で配置する。helperは実行ファイルの隣のMetalライブラリを明示的に使用し、開発機のDerivedDataへ依存しない。electron-builderにネスト実行ファイルを登録し、開発時生成物にはad-hoc署名を行う。正式配布のDeveloper ID署名・notarizationは既存リリース環境で必要であり、ローカルad-hoc検証と同一視しない。

MLX helperのdeployment targetはmacOS 14、アプリのオフライン対象はApple Siliconである。古いmacOSでの実行は別途確認が必要。macOS向け配布物の作成はApple Silicon上で行う。Windows/LinuxのパッケージにはMLX native artifactを同梱しない。

統合した`npm run build`とelectron-builderのmacOS arm64 dirパッケージ作成（ad-hoc署名、公証なし）、アプリ全体の`codesign --verify --deep --strict`は成功した。実際の配布ディレクトリにあるElectronを`ELECTRON_RUN_AS_NODE=1`で動かし、asar内の製品クライアントからasar外のhelperを起動して、英日両方向、特殊トークン表記のコード保持、streaming、中断と次要求の復旧を確認した。Metal bundle、Swift互換dylib、依存ライセンス、既存アイコンも配布物内にある。これはアプリの通常起動/UI操作やDeveloper ID署名・公証の検証ではない。

## 再現可能な検証

`npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test:verbose`でNode側の選択、download、protocol、期限、中断、異常終了、終了確認を検証する。GPU不要のfake processテストを含む。Swiftチェックアウト等の生成物はVitest対象から除外する。

native unit testは`native/mlx`で以下を実行する。

    xcodebuild -scheme HonyoMlx -configuration Release -destination 'platform=macOS,arch=arm64' -derivedDataPath ../../output/native-mlx/DerivedData -clonedSourcePackagesDirPath ../../output/native-mlx/SourcePackages -onlyUsePackageVersionsFromResolvedFile -disableAutomaticPackageResolution ARCHS=arm64 CODE_SIGNING_ALLOWED=NO MACOSX_DEPLOYMENT_TARGET=14.0 test

任意の`TEST_RUNNER_HONYO_MLX_TEST_MODEL=<absolute 7B checkpoint directory>`と`TEST_RUNNER_HONYO_MLX_TEST_MODEL_18=<absolute 1.8B checkpoint directory>`を指定すると、7Bと過去の1.8B実験チェックポイントの全特殊表記・Unicode/NULのbyte-exact検証、Rust参照ID fixtureとの照合も行う。7BはCRLF保持、1.8BはCRの明示拒否を検査する。未指定時は該当チェックポイント依存テストだけskipする。

製品クライアントの実モデルsmokeは以下で実行する。モデルは明示的に指定し、ユーザー設定やuserDataを変更せず、自動ダウンロードもしない。

    npx esbuild scripts/evaluate-mlx.ts --bundle --platform=node --format=esm --packages=external --outfile=output/native-mlx/dual-model/evaluate-local.mjs
    node output/native-mlx/dual-model/evaluate-local.mjs <verified model path> [helper path] [registered model ID]

短文20例・長文4例を2巡し、英日両方向の2000文字境界、特殊表記のコード保存、生成中の中断と次要求の復旧を確認する。出力JSONLにはfixtureの原文・訳文を含むため、ローカル評価用とし、利用者のコピー内容を投入して共有しない。

## 評価と限界

事前の順序反転ペアPoCでは、Q3 GGUF Metalに対しSwift MLX 4bitの全文完了中央値は短文239.93→182.40 ms、長文3010.74→2381.51 msだった。短文TTFTの数msだけでなく、全文完了時間を重視する。Q3のMetal used 4189 MiBとMLX active 4161.2 MiB / peak 4774.3 MiBは別指標であり、同一測定値や加算可能な値ではない。

製品クライアントでも同じ24例×2巡をApple Silicon / macOS 27 / Xcode 27で実測し、48翻訳のエラー・echo・巡回間の訳文差はいずれも0、2000文字の英日両方向と特殊表記の境界3例、および中断後の復旧も成功した。製品クライアントの最初のテキストchunk/全文完了中央値は短文46.22/186.28 ms、長文132.23/2396.94 msだった。これはNode側のchunk受信時刻であり、PoCの生成token callback TTFTと同一指標ではない。初回ロード・方向別cold compilationはwarm測定から除外した。

24例のAI定性評価は人間による品質検証を代替しない。専門用語・期限の意味・量子化の品質差には未解決の問題がある。製品fixtureの短文でも`idempotent`を「再実行可能」とする訳や、`before September 30`を「9月30日までに」とする境界の曖昧化が残った（いずれも事前のGGUF評価でも見られた問題）。出力検査はコード・URL欠落やecho、長さ切断等を検出するが、訳の正しさ全般を保証しない。低bit MLX、電力、古いmacOS、正式署名/notarizationはこのPRで実証した事項ではない。

## 後片付け

PoCモデル・Python環境・既存の未追跡ファイル・ユーザーのモデルはこの実装で削除しない。`output/model-evaluation/`と`output/native-mlx/`の取得物、DerivedData、評価ログ、および`build/`/`dist/`は再生成可能な検証・ビルド生成物である。生成物の削除はユーザーの指示後に行う。追跡する`native/mlx/`、ビルド/評価スクリプト、製品コードはPoC削除対象にしない。
