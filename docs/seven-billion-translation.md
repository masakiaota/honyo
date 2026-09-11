# 7B前後の英日翻訳モデルをM3 Airで比較

2026年9月11日、M3 MacBook Air（24 GB）でHy-MT2 7B、CAT-Translate 7B、CAT-Translate 3.3BのQ4_K_Mを実行した。既存のHy-MT2 1.8Bと同じ60例で比較した。 **今回の3候補では、品質重視で追加検討するならHy-MT2 7Bが最有力だった。** 1.8Bの全面的な上位互換ではないが、専門用語や人物関係の改善があり、常駐後の表示開始も中央値0.68秒だった。CATは今回のGGUF版と設定では採用を見送る。

## 表示開始とメモリ

すべてQ4_K_M。1.8Bは前回の同じ60例の結果を再掲した。

| モデル              | 最初の文字・中央値 | 同95パーセンタイル | 最初の20文字・中央値 | 最大RSS（2周目） |
| ------------------- | -----------------: | -----------------: | -------------------: | ---------------: |
| Hy-MT2 1.8B（基準） |            0.176秒 |            0.218秒 |              0.337秒 |        1,662 MiB |
| **Hy-MT2 7B**       |        **0.676秒** |        **1.099秒** |          **1.376秒** |    **5,126 MiB** |
| CAT-Translate 7B    |            0.551秒 |            0.867秒 |              0.927秒 |        5,034 MiB |
| CAT-Translate 3.3B  |            0.263秒 |            0.341秒 |              0.499秒 |        2,764 MiB |

完了までの中央値はHy 7Bが2.43秒、CAT 7Bが1.96秒、CAT 3.3Bが1.17秒だった。ただしCAT 7Bは6番で両周とも90秒の上限に達した。表示開始が速くても、その出力は翻訳として使えなかった。

2周の出力はHyとCAT 3.3Bで60例すべて一致した。CAT 7Bは59例が一致し、90秒で中断した6番のみ末尾が異なった。正常な終了トークンで止まったことは、翻訳が正しいことを意味しない。

7Bの常駐には約5 GiBの推論プロセス分の余裕が必要になる。この24 GB機では実行できたが、測定前からシステムのスワップが約2.9 GBあり、測定中は約3.7 GBになった。ほかのアプリや中断した並行試行の影響も含むため増加をモデル単独には帰属できず、「常駐しても他の作業が重くならない」とはまだ断言できない。8 GB機への推奨にも使えない結果だ。

## 品質の具体例

番号は共通60例の `caseIndex`（0始まり）。

| モデル             | 改善・保持できた例                                                                                                                                                                                                     | 残った問題                                                                                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hy-MT2 7B          | 25番の冪等性キーを `idempotent key` と訳し、1.8Bの `power-of-two key` から改善。34番のマージ担当者をBobと保持。56番はケンのパソコンが修理中で、マヤのパソコンを貸した関係を明示。6・40・41番も命令を実行せず翻訳した。 | 2番の `idempotent` は「再実行可能」で意味が不十分。17番の `before September 30` は「9月30日まで」となり境界が曖昧。48番の `up to five business days` は「5営業日ほど」と上限が弱まる。57番ではパソコンの修理中をKen本人が修理している表現にした。                                          |
| CAT-Translate 7B   | 通常文では読みやすい出力が多く、20番の決済条件、25番の冪等性キー、34番の人物関係、48番の最大5営業日を保持した。                                                                                                        | 2番の `idempotent` に誤った「非破壊的」の説明を付ける。6番で冗談の生成と反復が続き90秒で中断。40・41番も原文への返答になる。37番で見出しを落とし、URL末尾の `guide` を `guid` に変更。39番は「嫌いになったわけじゃない」を `I don't hate you anymore` とし、以前は嫌っていた意味を加える。 |
| CAT-Translate 3.3B | 2番を「冪等」、25番を `idempotent key` と訳す。料金と送料・割引条件を保持できた。                                                                                                                                      | 0番の保存後の再起動を「保存する前」に逆転。3番で意味をなさない文字列。19番に「1階」、48番に「10営業日以内」を加え、53番の80を180に変更。                                                                                                                                                   |

CAT 3.3Bは[問題例中心の16例](../scripts/fixtures/cat-diagnostic.json)で反復抑制を1.0にして再実行したが、保存前への逆転、意味をなさない文字列、80から180への変更が残った。[診断の実出力](evaluation/seven-cat3-penalty1.json)も保存した。今回の設定変更だけでは採用可能な状態にならなかった。

### CAT 7Bの指示調整

[16例](../scripts/fixtures/cat7-framing-check.json)で、システム指示を翻訳専用にし、ユーザー側にも翻訳指示を追加して原文を `<source_text>` で囲んだ。40番は命令を実行せず訳せたが、6番では拒否文、41番では拒否文に続いて詩を返した。37番はURLを `guide` から `guidance` に変え、39番の `don't hate you anymore` も残った。追加指示や囲みタグ自体が出力に混ざる例もあった。この調整だけでは安定しなかった。[実出力](evaluation/seven-cat7-framed.json)は通常設定の速度集計と分けて保存した。

## 測定条件

[60例の原文](../scripts/fixtures/additional-models.json)を各モデルで2周実行した。モデルの重みは常駐させ、各文章のコンテキストだけ作り直す。node-llama-cpp 3.20.0、Metal、CPU 2スレッド、コンテキスト4,096、バッチ128、flash attention、temperature 0、反復抑制1.05、上限2,048トークン・90秒を使用した。

Hy-MT2 7Bの制御トークンは1.8Bと異なる。7Bの公式テンプレートに合わせて `<|startoftext|>指示と原文<|extra_0|>` とした。翻訳指示自体はアプリと同じ。CATは各サイズの公式テンプレートと `Translate the following {source} text into {target}.` の指示を使った。[GGUF内のメタデータ](evaluation/seven-gguf-metadata.json)も照合した。

最初の文字までの時間は、コンテキスト作成開始から最初の `onTextChunk` 通知までを測った。モデル読み込み、ファイル検証、Electronの描画は含まない。**翻訳に失敗した文章の出力開始も含む**。2周目の中央値とnearest-rank法の95パーセンタイルを用い、20文字未満の出力は20文字到達時間から除外する。RSSは推論プロセスの値であり、アプリ全体の使用量や上限ではない。

確定した比較では推論を一つずつ行った。デスクトップの他の負荷は隔離していない。Hyの前半はモデルのダウンロードも並行していた。誤ったHyテンプレートによる試行と、推論が一時的に重なった中断試行は集計から除外し、最初から測り直した。

## 品質の確認方法

作業担当のAIが原文と出力を照合した。否定、条件、日付、数値、人名、コード、原文中の命令への応答を確認した。合成60例の診断であり、盲検の人手評価や実利用全体の誤訳率ではない。モデルのプロンプト・生成設定・量子化を網羅して最適化した評価でもない。

## 実出力と重み

[集計](evaluation/seven-summary.json)、[Hy 7Bの全出力](evaluation/seven-hy.json)、[CAT 7Bの全出力](evaluation/seven-cat7.json)、[CAT 3.3Bの全出力](evaluation/seven-cat3.json)を保存した。アプリの選択モデル・実装・配布物は変更していない。

[固定リビジョン・サイズ・SHA-256](evaluation/seven-models-manifest.json)を保存した。HyはTencent公式GGUF、CATは第三者によるGGUF変換を使った。ハッシュ検証は配布ファイルとの一致を確認するもので、非量子化の公式モデルとの品質同等性を保証しない。特にCATの結果は今回の変換ファイルと設定についての結果だ。

```bash
node scripts/evaluate-local.ts /absolute/path/to/Hy-MT2-7B-Q4_K_M.gguf hy7 60 scripts/fixtures/additional-models.json 2
node scripts/evaluate-local.ts /absolute/path/to/cat-translate-3.3b-Q4_K_M.gguf cat3 60 scripts/fixtures/additional-models.json 2
node scripts/evaluate-local.ts /absolute/path/to/CAT-Translate-7b.Q4_K_M.gguf cat7 60 scripts/fixtures/additional-models.json 2
# CAT 7Bのシステム指示と原文の区切りを変更する診断
node scripts/evaluate-local.ts /absolute/path/to/CAT-Translate-7b.Q4_K_M.gguf cat7 16 scripts/fixtures/cat7-framing-check.json 1 1.05 framed
# CAT 3.3Bの反復抑制を外す診断（問題例中心の16例）
node scripts/evaluate-local.ts /absolute/path/to/cat-translate-3.3b-Q4_K_M.gguf cat3 16 scripts/fixtures/cat-diagnostic.json 1 1
```

公式情報：[Hy-MT2 7B](https://huggingface.co/tencent/Hy-MT2-7B)、[CAT 7B](https://huggingface.co/cyberagent/CAT-Translate-7b)、[CAT 3.3B](https://huggingface.co/cyberagent/CAT-Translate-3.3b)。比較対象の過去結果：[Hy-MT2 1.8Bほか小型モデル](additional-local-models.md)、[TranslateGemma 4B](translation-streaming-comparison.md)。
