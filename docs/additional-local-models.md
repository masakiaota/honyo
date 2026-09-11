# 最近の小型モデル3種の英日翻訳評価

2026年9月11日、このM3 MacBook Air（24 GB）でLFM2.5-1.2B-JP-202606、Qwen3.5-4B、Shisa V2.1 Llama 3.2 3Bを実行した。今回の設定と文章では、Hy-MT2を全面的に置き換えられるほど安定した候補は見つからなかった。自然な文章や用語の改善があっても、原文への返答、条件の逆転、人名・数値の欠落が残った。

## 条件と測定範囲

[前回の48例](translation-streaming-comparison.md)に、返金、通知と退会、割合、ロック処理、人物関係など12例を追加した。[60例](../scripts/fixtures/additional-models.json)を基準のHy-MT2を含む各モデルで2周実行し、モデルが読み込まれた2周目の値を集計した。出力はモデルごとに2周とも60例すべて一致した。LFMは同内容の指示を日本語にした条件でも2周測定した。

llama.cppをnode-llama-cpp 3.20.0から使用し、Metal、CPU 2スレッド、コンテキスト4,096、バッチ128、flash attention、temperature 0、反復抑制1.05とした。各文章で新しいコンテキストを作り、モデルの重みは保持した。Qwenは思考なしのテンプレートを使った。最大2,048トークン、90秒の制限を設けた。推論はHy、LFM英語指示、LFM日本語指示、Qwen、Shisaの順に一つずつ実行した。デスクトップの負荷は隔離しておらず、前半はダウンロードも並行していた。

速度はコンテキスト作成開始から最初の `onTextChunk` 通知までで、ファイル検証・モデル読み込み・Electronの描画は含まない。**説明や冗談など、翻訳として不適切な出力の開始も含む**ため、これだけを利用可能な翻訳の待ち時間とは見なさない。

## 表示開始とメモリ

| モデル（すべてQ4_K_M） | 最初の文字・中央値 | 最初の文字・95パーセンタイル | 最初の20文字・中央値 | 最大RSS |
| --- | ---: | ---: | ---: | ---: |
| Hy-MT2 1.8B（基準） | 0.176秒 | 0.218秒 | 0.337秒 | 1,662 MiB |
| LFM2.5 1.2B JP-202606・英語指示 | 0.103秒 | 0.131秒 | 0.166秒 | 996 MiB |
| 同・日本語指示 | 0.128秒 | 0.168秒 | 0.177秒 | 996 MiB |
| Qwen3.5 4B・思考なし | 0.470秒 | 0.743秒 | 0.804秒 | 3,075 MiB |
| Shisa V2.1 3B | 0.409秒 | 0.902秒 | 0.707秒 | 2,673 MiB |

95パーセンタイルはnearest-rank法。20文字未満の出力は20文字到達時間の集計から除外した。RSSは推論プロセスの実測であり、アプリ全体の上限ではない。LFMは非常に軽い。QwenとShisaの表示開始も中央値で0.5秒以内なので、今回の主な不採用理由は速度より品質にある。

## 品質の具体例

番号は60例の `caseIndex`（0始まり）。英語の共通指示で得た出力を手動で原文と照合した。

| モデル | 良かった例 | 問題があった例 |
| --- | --- | --- |
| LFM2.5 JP-202606 | 1番の連絡期限を保持。20番の決済再試行条件を保持。46番の `Not yet.` は「まだです」。 | 2・11・24番などで英語を日本語へ訳さず返す。6・40・41番では原文の命令に従う。35番のTakahashiが `high橋`、57番の真由がYumiになる。 |
| Qwen3.5 4B | 25番の冪等性キーを `idempotency key` と訳す。47番の「念のため」は `Just in case.`。料金・割合・コードを保持できた例もある。 | 17番の `before September 30` が「9月30日以降にキャンセルすると…請求が発生しません」。20番の再試行条件も崩れる。34番のCarolがカールになる。40番では日本語への翻訳をせずフランス語で拒否を返す。 |
| Shisa V2.1 3B | 11番のworkspaceからの退出、14番の二重否定、15番の `not necessarily` を適切に表す。 | 6・40・41番で翻訳せず冗談・説明・詩を出す。33番で2,980円と送料への適用条件を落とす。34番は「ボブではなくアリスが…マージ」。36番で `timeout_ms=30000` の値を落とす。 |

Hy-MT2も、25番の冪等性キーを `power-of-two key` とする誤訳が再現し、56番ではパソコンの所有者が不明瞭になる。基準モデルが正解を保証するという結論ではない。

### 指示言語・翻訳対象の区切り方の確認

LFMに同内容を日本語で指示しても、原文のコピーや詩の生成が残った。翻訳対象の区切り方も確認するため、失敗例を中心とする[16例](../scripts/fixtures/translation-framing-check.json)で、ユーザーメッセージにも翻訳指示を付け、原文を `<source_text>` で囲んだ。3モデルそれぞれ1周の診断であり、上表の速度測定とは分けている。

LFMは2番のidempotentや4番の依頼文を翻訳するようになったが、40・41番では依然としてフランス語訳の説明や詩を生成した。Qwenの40番は正しく翻訳するようになったが、20番の再試行条件の誤りが残り、34番はAliceをエリカに変えた。Shisaは2番のidempotentを「同期処理ではない場合」と誤訳し、6番では冗談を生成した。区切り方は改善に効くが、この変更だけで採用できる品質にはならない。

## 評価の限界と次の判断

これは合成した60例を作業担当のAIが読む診断であり、盲検の人手評価や代表的な翻訳ベンチマークではない。難しい既知の例が含まれ、失敗率を実利用全体へ外挿できない。モデル別のプロンプト・量子化・生成設定を網羅した最適化でもない。一般的な日本語能力の評価と、翻訳専用アプリで原文を忠実に扱う能力は分けて判断する必要がある。

3モデルは実際に動いたが、今回はアプリに追加しない。Gemma 4 E2Bはこの評価には含めていない。

## 実出力と再現

[モデルの固定リビジョンとSHA-256](evaluation/additional-models-manifest.json)、[集計](evaluation/additional-summary.json)、[Hy-MT2](evaluation/additional-hy.json)、[LFM英語指示](evaluation/additional-lfm.json)、[LFM日本語指示](evaluation/additional-lfmja.json)、[Qwen](evaluation/additional-qwen.json)、[Shisa](evaluation/additional-shisa.json)を保存した。

```bash
node scripts/evaluate-local.ts /absolute/path/to/model.gguf lfmjp 60 scripts/fixtures/additional-models.json 2
node scripts/evaluate-local.ts /absolute/path/to/model.gguf lfmjp-ja 60 scripts/fixtures/additional-models.json 2
node scripts/evaluate-local.ts /absolute/path/to/model.gguf qwen 60 scripts/fixtures/additional-models.json 2
node scripts/evaluate-local.ts /absolute/path/to/model.gguf shisa 60 scripts/fixtures/additional-models.json 2
# 区切り方の確認。familyはlfmjp、qwen、shisaのいずれか。
node scripts/evaluate-local.ts /absolute/path/to/model.gguf lfmjp 16 scripts/fixtures/translation-framing-check.json 1 1.05 framed
```

区切り方を変えた実出力：[LFM](evaluation/framed-lfm.json)、[Qwen](evaluation/framed-qwen.json)、[Shisa](evaluation/framed-shisa.json)。

公式情報：[Liquidモデル](https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP-202606)、[Liquid GGUF](https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP-202606-GGUF)、[Qwen](https://huggingface.co/Qwen/Qwen3.5-4B)、[Shisa](https://huggingface.co/shisa-ai/shisa-v2.1-llama3.2-3b)。各モデルの入力形式を確認して利用した。重みはGitに含めず、アプリの選択モデルや配布物は変更していない。
