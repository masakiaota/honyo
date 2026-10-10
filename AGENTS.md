# PR作成

- PRの対象リポジトリは必ず `masakiaota/honyo` とする。`eukarya-inc/honyo` へ影響を及ぼしてはいけない。
- `gh pr create` は引数なしで実行しない。`--repo`・`--base`・`--head` を必ず明示する（fork構成では既定の解決先がupstreamになるため）。
- 作成後は `gh pr view` のURLとbase所有者が意図どおりかを確認してから報告する。
