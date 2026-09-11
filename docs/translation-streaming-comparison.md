# Hy-MT2とTranslateGemmaの追加比較

このM3 MacBook Air（24 GB）では、TranslateGemma 4B・4bitも逐次表示に十分検討できる速度だった。ただし、追加評価では原文にない人物への置き換えや短文の誤訳が見つかった。今回の結果から、Hy-MT2を全面的に置き換えるほど品質が安定しているとは判断しない。専門用語に強い場面はあり、用途を絞った比較候補としては残る。

## 測定条件

2026年9月9日（日本時間）に、前回の20例へ28例を追加し、[同じ48例](../scripts/fixtures/translation-comparison.json)を両モデルで2周ずつ実行した。日本語向け25例、英語向け23例を含む。料金、否定、期限、人物関係、技術用語、敬語、会話、Markdown、命令形の翻訳対象、短文、長めの説明文を手動で評価した。既知の苦手な表現も含む診断用の小さな集合であり、一般的な翻訳品質を代表するベンチマークではない。評価者はこの作業を担当するAIで、独立した人間による評価や盲検評価ではない。

モデルは常駐させ、各文章に新しいコンテキストを作る。node-llama-cpp 3.20.0、Metal、CPU 2スレッド、コンテキスト4,096、バッチ128、flash attention、temperature 0、反復抑制1.05で実行した。Hy-MT2はアプリのプロンプト、TranslateGemmaは専用の翻訳テンプレートを使った。モデルは同時に推論させず、Hy-MT2、TranslateGemmaの順に測った。普段のデスクトップ作業は継続し、Hy-MT2測定時にはモデルのダウンロードも行っていたため、実験室のように負荷を隔離した測定ではない。

両モデルとも2周の出力は48例すべて一致した。以下の速度はモデルが読み込まれた2周目を使う。最初の文字までの時間は、コンテキスト作成開始から最初の `onTextChunk` 通知までを測り、入力処理を含む。モデルの読み込みやファイル検証、Electronの画面描画は含まない。生の最初のトークンではなく、表示できる文字が出た時点を測っている。

## 逐次表示の速度

| 指標 | Hy-MT2 1.8B Q4_K_M | TranslateGemma 4B Q4_K_M |
| --- | ---: | ---: |
| 最初の文字・中央値 | 0.178秒 | 0.388秒 |
| 最初の文字・95パーセンタイル | 0.223秒 | 0.830秒 |
| 最初の20文字・中央値 | 0.333秒 | 0.709秒 |
| 全文の完了・中央値 | 0.743秒 | 1.265秒 |
| 日本語の表示速度・中央値 | 約72文字/秒 | 約51文字/秒 |
| 英語の表示速度・中央値 | 約217文字/秒 | 約109文字/秒 |
| 各文章の最長表示間隔・中央値 | 24ミリ秒 | 45ミリ秒 |
| 観測した表示間隔の最大値 | 115ミリ秒 | 251ミリ秒 |
| 推論プロセスの最大RSS | 1,621 MiB | 2,812 MiB |

20文字未満の出力は20文字到達時間と表示速度の集計から除外した。表示速度は最初の文字から完了までの平均文字数/秒を文章ごとに求めた概算で、トークン/秒とは異なる。95パーセンタイルはnearest-rank法。RSSはアプリ全体のメモリ消費や上限値ではない。

TranslateGemmaで増えた表示開始の待ちは中央値で約0.21秒だった。今回の日本語出力は約51文字/秒で進むため、全文完了の遅さだけを理由に除外する判断は適切ではない。ただし長めの入力では表示開始に約1秒かかる例もあり、読み始めるまでの待ちに差はある。人間の読書速度や満足度そのものは測定していない。

## 翻訳品質の具体例

番号は評価ファイルの `caseIndex`（0始まり）を示す。表の抜粋だけでなく、全文を照合して判断した。

| 番号・論点 | Hy-MT2 | TranslateGemma | 判断 |
| --- | --- | --- | --- |
| 25：冪等性キー | `power-of-two key` | `idempotency key` | TranslateGemmaが正確。Hy-MT2は別の技術概念になる。 |
| 2：idempotent | 「イデミポテント」 | 「冪等」と正しく訳すが、原文にない定義を括弧で追加 | 用語はTranslateGemmaが良い。翻訳のみの要件には追加説明が不要。 |
| 11：leave a workspace | 「その場を離れる」 | 「ワークスペースから退出」 | TranslateGemmaが文脈を正しく表す。 |
| 15：does not necessarily mean | 「という意味ではありません」 | 「必ずしも…意味するわけではありません」 | TranslateGemmaが論理的な限定を保持する。 |
| 27：保存ボタンの不具合 | 意味は保持するが、英文がやや不自然 | 自然な英文で意味も保持 | TranslateGemmaが読みやすい。 |
| 34：Bobがマージ、Aliceではない | Bobを保持 | 「ボブではなく、キャロルが…マージ」 | TranslateGemmaが行為者を変え、否定の関係も逆転する。 |
| 46：Not yet. | 「まだです」 | 「まだではありません」 | TranslateGemmaは短文でも不適切。 |
| 47：念のため。 | `Just in case.` | `Just to be clear.` | TranslateGemmaは目的を変える。 |
| 24：endpointとdeprecation period | 用語を保持 | 「従来の環境」「移行期間」に置換 | TranslateGemmaは技術的な具体性を失う。 |
| 22：金曜までに発送、同日到着は保証しない | 期限との関係を保持 | 「その到着を保証することはできません」 | TranslateGemmaは到着期限を落とし、到着自体の保証に読める。 |
| 13：old merchant / sword | 「古い商人」は不自然 | 「古参の商人」「お宝の剣」 | どちらも改善の余地があり、TranslateGemmaは剣にない属性を追加する。 |
| 17：before September 30 | 「9月30日まで」 | 「9月30日まで」 | 両方とも境界日が曖昧になる。 |
| 39：嫌いになったわけじゃない、と彼女は言った | `it`を補うが発話者は保持 | `him`を補い、発話者の説明を落とす | 原文にない対象の補完は両方にある。TranslateGemmaには省略もある。 |
| 44：デプロイ前に検知できなかった理由 | 理由を保持 | 「自動チェックが問題を発見する前に、なぜ検出できなかったのか」 | TranslateGemmaは時間関係と調査対象を崩す。 |

料金やコード・URLを保持できた例も多く、TranslateGemmaが常に不正確という結果ではない。技術用語や自然さの改善と、人物・条件・短文の意味を取り違える問題が併存している。モデルの大きさや文章の滑らかさだけでは選定できない。

## 反復抑制を外した追加確認

TranslateGemmaだけ、反復抑制を1.05から1.0（抑制なし）にして48例をさらに1周実行した。38例は出力が同一で、10例に差があった。endpointを保持するなど一部は改善したが、34番の行為者の逆転、46番の「まだではありません」、47番の `Just to be clear.` は同じだった。主要な問題は、この設定変更だけでは解消しない。[この条件の実出力](evaluation/streaming-gemma-penalty1.json)も保存した。

## 再現と実出力

モデルのリビジョンは[前回の比較](local-translation.md)と同じ。TranslateGemmaの専用テンプレートは[Googleのモデルカード](https://huggingface.co/google/translategemma-4b-it)に従う。

```bash
node scripts/evaluate-local.ts /absolute/path/to/Hy-MT2-1.8B-Q4_K_M.gguf hy2 48 scripts/fixtures/translation-comparison.json 2
node scripts/evaluate-local.ts /absolute/path/to/translategemma-4b-it.Q4_K_M.gguf gemma 48 scripts/fixtures/translation-comparison.json 2
node scripts/evaluate-local.ts /absolute/path/to/translategemma-4b-it.Q4_K_M.gguf gemma 48 scripts/fixtures/translation-comparison.json 1 1
```

実出力と時間は [Hy-MT2](evaluation/streaming-hy.json)、[TranslateGemma](evaluation/streaming-gemma.json)、[集計](evaluation/streaming-summary.json)に保存した。アプリの採用モデル・設定・配布物は変更していない。
