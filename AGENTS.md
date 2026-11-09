# PR作成

- PRの対象リポジトリは必ず `masakiaota/honyo` とする。`eukarya-inc/honyo` へ影響を及ぼしてはいけない。
- `gh pr create` は引数なしで実行しない。`--repo`・`--base`・`--head` を必ず明示する（fork構成では既定の解決先がupstreamになるため）。
- 作成後は `gh pr view` のURLとbase所有者が意図どおりかを確認してから報告する。

# macOSアプリ更新

- ユーザー指定のAppleアカウントに紐づく証明書を使い、更新間で署名IDを維持する。アドホック署名（`-`）で既存アプリを置き換えない。
- 入れ替え前に、使用証明書と署名の有効性を確認する。
