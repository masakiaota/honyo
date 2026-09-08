# main のアプリをローカルから公開する

ユーザーから「今の main をリリースして」と依頼されたときに、この手順を実行する。Apple Silicon Mac で `Honyo.app` をビルドし、ZIP にして `masakiaota/honyo` の GitHub Releases に公開する。GitHub Actions、Secrets、公証は使わない。macOS の初回起動時の警告は許容する運用だ。

## 1. 公開対象の取得

このリポジトリ内から、以下を同じシェルで順に実行する。Node.js 24、Xcode Command Line Tools、認証済みの `gh` が必要だ。いずれかのコマンドが失敗したら、公開へ進まず原因を解消する。

```bash
set -e
test "$(uname -m)" = arm64
gh auth status
git fetch origin main
release_commit=$(git rev-parse origin/main)
release_root=$(mktemp -d "${TMPDIR:-/tmp}/honyo-release.XXXXXX")
git worktree add --detach "$release_root/source" "$release_commit"
cd "$release_root/source"
release_tag="main-$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
```

作業中のブランチや未コミットの変更は含めない。公開対象は取得時点のコミットに固定する。タグは日時とコミットで区別し、アプリのバージョン番号は main の値をそのまま使う。

## 2. ビルドと起動確認

```bash
npm ci
npm run typecheck
npm run lint
npm run test:verbose
npm run build
npx electron-builder --mac --arm64 --dir --publish never --config.mac.notarize=false
codesign --verify --deep --strict dist/mac-arm64/Honyo.app
```

署名にはローカルで利用できる証明書を使う。配布用証明書の追加は要求しない。証明書がなく署名で失敗する場合は、最後のビルドコマンドに `--config.mac.identity=-` を追加してアドホック署名で作り直す。署名検証の失敗は無視しない。

稼働中の Honyo を終了してから、次のコマンドで今回のアプリを起動する。設定画面と英日翻訳を確認し、終了する。既存の `/Applications/Honyo.app` は置き換えない。

```bash
open dist/mac-arm64/Honyo.app
```

## 3. ZIP 化と公開

```bash
release_zip="$release_root/Honyo-$release_tag-arm64.zip"
ditto -c -k --sequesterRsrc --keepParent dist/mac-arm64/Honyo.app "$release_zip"
unzip -tq "$release_zip"
```

`$release_root/notes.md` を作成し、変更点、`$release_commit` の完全なコミット ID、次の利用案内を英語で記載する。モデル本体やユーザーの設定・認証情報は添付しない。

> Apple Silicon Macs only. Extract the ZIP and move Honyo.app to Applications. This build is not notarized by Apple. If macOS blocks opening it, try opening the app once, then go to System Settings → Privacy & Security → Open Anyway, if available. Only allow an app you trust. Offline translation requires a one-time model download. To update, quit Honyo and replace the app with a newer download from this repository; do not use the in-app updater for this build.

起動と ZIP の確認が済んだら、公開依頼の範囲内で次を実行する。

```bash
gh release create "$release_tag" "$release_zip" \
  --repo masakiaota/honyo \
  --target "$release_commit" \
  --title "Honyo $release_tag (Apple Silicon)" \
  --notes-file "$release_root/notes.md" \
  --latest
gh release view "$release_tag" --repo masakiaota/honyo --json url,assets,targetCommitish
```

GitHub が指定コミットにタグを作成する。タグ連動のリリース用ワークフローは削除済みなので、別のビルドや Homebrew 更新は発生しない。公開が途中で失敗した場合は `gh release view` で状態を確認し、既存のタグや添付ファイルを無条件に上書きしない。

完了後はリリース URL をユーザーに返す。元のリポジトリに戻り、`git worktree remove "$release_root/source"` で作業用ディレクトリを解除する。ZIP と公開文は `$release_root` に残る。アプリの自動更新設定や公証の整備は、この手順の対象外とする。
