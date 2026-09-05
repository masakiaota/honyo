# Honyo

[English（正本）](README.md) | 日本語

<img src="assets/icon.svg" width="96" height="96" alt="Honyo のアイコン">

**文章を選び、Command（Windows/Linux では Ctrl）を押したまま C を素早く二度押すと翻訳できる。**

Honyo は、**DeepL のような操作感**で使えるデスクトップ翻訳アプリだ。選択した文章を好みの AI モデルで翻訳し、ポップアップまたは通知に結果を表示する。

このリポジトリは、[eukarya-inc/honyo](https://github.com/eukarya-inc/honyo) に ChatGPT ログインとモデルごとの推論設定、Fast mode を追加した [masakiaota による派生版](https://github.com/masakiaota/honyo)だ。

![Honyo のポップアップウィンドウとトレイメニュー](assets/screenshot.png)

## 主な特長

- **ChatGPT アカウントで翻訳する**：ログインすると、アカウントの Codex で利用できるモデルを使える。API キーの準備は不要だ。
- **推論の強さと Fast mode を選ぶ**：軽量なモデルと低推論を組み合わせることで高速なレスポンスを実現
- **AI の提供元を選ぶ**：API キーを使って Claude、GPT、Gemini で翻訳できる。API モデルの一覧は公開カタログから自動で更新される。
- **双方向に翻訳する**：原文に応じて、主言語と副言語のどちらに翻訳するかを選ぶ。逆翻訳で結果を読み直すこともできる。
- **訳文の書き方を指定する**：用語や文体の指示を追加できる。指示文の作成を AI に手伝わせることもできる。

## 利用条件

翻訳にはインターネット接続と、次のいずれかの接続方法が必要だ。

| 接続方法         | 必要なもの                                                  | 利用枠と料金                                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT ログイン | Codex を利用できる ChatGPT アカウント                       | 翻訳は Codex の利用枠を消費する。利用できるモデルと上限はアカウントによって異なる。[Codex の料金と利用上限](https://learn.chatgpt.com/docs/pricing)を参照。                                         |
| API キー         | 選択する Anthropic、OpenAI、Google のモデルを利用できるキー | 各社の API 料金と利用上限が適用される。OpenAI API の料金は ChatGPT の契約料金と別に請求される。[OpenAI の認証方法と料金の説明](https://learn.chatgpt.com/docs/auth#sign-in-with-an-api-key)を参照。 |

翻訳時には、原文と追加した翻訳指示を選択中の AI サービスへ送信する。送信した情報には、そのサービスのデータ取り扱い方針が適用される。

## ソースから起動する

この派生版には、現在、ビルド済みアプリの公開リリースがない。このリポジトリのソースからビルドして起動する。

### ビルドに必要なもの

Git、**Node.js 23.6.0 以上**、npm を用意する。ネイティブモジュールのビルドには、次のツールも必要だ。導入方法は [node-gyp のインストールガイド](https://github.com/nodejs/node-gyp#installation)を参照。

| OS      | ネイティブモジュールのビルドに必要なツール                                                         |
| ------- | -------------------------------------------------------------------------------------------------- |
| macOS   | Python 3 と Xcode Command Line Tools（`xcode-select --install`）。Node.js の開発用ヘッダーも必要。 |
| Windows | Python 3 と Visual Studio 2022。「C++ によるデスクトップ開発」をインストールする。                 |
| Linux   | Python 3、`make`、C/C++ コンパイラー、X11 の開発用ライブラリ。                                     |

<details>
<summary>Debian/Ubuntu のビルド依存パッケージ</summary>

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3 \
  libx11-dev libxtst-dev libxt-dev libx11-xcb-dev \
  libxkbcommon-dev libxkbcommon-x11-dev libxrandr-dev \
  libxinerama-dev libxcursor-dev libxi-dev
```

</details>

### Honyo の起動

```bash
git clone https://github.com/masakiaota/honyo.git
cd honyo
npm ci
npm start
```

`npm start` はアプリをビルドしてから起動する。Honyo はシステムトレイ、macOS ではメニューバーに常駐する。そのメニューから設定を開ける。

macOS では、ショートカットを検出するために**システム設定 → プライバシーとセキュリティ → アクセシビリティ**でアプリを許可する。`npm start` で起動した場合は Electron が対象になる。該当する Electron を有効にし、許可後に `npm start` を再実行する。

## 最初の翻訳

### ChatGPT で接続する場合

1. トレイメニューから **Settings... → API Keys** を開く。
2. **ChatGPT/Codex** の **Sign in with ChatGPT** を選び、ブラウザーでログインを完了する。
3. Honyo に戻り、トレイメニューの **AI Model** から、名前の末尾が **(ChatGPT)** のモデルを選ぶ。

**(ChatGPT)** は Codex の利用権限で使うモデルを示す。それ以外の提供元のモデルは API キーを使う。

### API キーで接続する場合

1. [Anthropic Console](https://console.anthropic.com/)、[OpenAI Platform](https://platform.openai.com/api-keys)、[Google AI Studio](https://aistudio.google.com/apikey)のいずれかでキーを取得する。
2. **Settings... → API Keys** を開き、対応する提供元の欄にキーを入力して **Save** を選ぶ。
3. トレイメニューの **AI Model** から、その提供元のモデルを選ぶ。

### 翻訳の操作

1. **Primary** に普段読みたい主言語、**Secondary** にもう一方の副言語を設定する。
2. トレイメニューの **Display Mode** で表示方法を選ぶ。訳文を読んで確認するなら **Popup Window**、結果を自動でコピーするなら **Notification & Copy** を選ぶ。
3. 文章を選び、macOS では **Cmd+C を二度**、Windows と Linux では **Ctrl+C を二度**、素早く押す。

主言語の文章は副言語へ、それ以外の言語の文章は主言語へ翻訳する。たとえば主言語が日本語、副言語が英語なら、英文は日本語に、日本語の文章は英語になる。

| 表示方法            | 動作                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Popup Window        | 訳文と翻訳方向を表示する。**⇄** で逆翻訳して確認できる。**Enter** または **Copy** でコピーして閉じ、**Escape** で閉じる。 |
| Notification & Copy | システム通知を表示し、クリップボードの内容を訳文に置き換える。初期設定はこちら。                                          |

トレイメニューの **Pause Translation** でショートカットを一時停止できる。実行中の翻訳を取り消すには **Stop Current Translation** を選ぶ。

## モデルと翻訳の設定

### 推論の強さと Fast mode

トレイメニューでモデルを選び、**Settings... → Model** を開く。

- **Reasoning effort**：モデルがどの程度推論するかを設定する。標準の動作を使う場合は **Use the model default** を選ぶ。
- **Use Fast mode**：選択中のモデルが対応している場合に、高速な処理を要求する。

**Save** を選ぶと、選択中のモデルの設定として保存される。利用できる設定はモデルによって異なり、ChatGPT のモデルではアカウントのモデル一覧から選択肢を取得する。

ChatGPT で Fast mode を使うと、Codex の利用枠の消費が増える。対応する OpenAI API モデルでは、個別の API 料金が設定された Priority 処理を使う。[OpenAI による Fast mode と料金の説明](https://learn.chatgpt.com/docs/agent-configuration/speed)を参照。

### 翻訳指示

**Settings... → Customization → Custom Prompt** で毎回の翻訳に含める指示を入力し、**Save** を選ぶ。たとえば、次のように指定できる。

```text
製品名は原語のまま残す。
ソフトウェア開発の用語を統一する。
文体を敬体にする。
```

**Generate with AI** を使うと、選択中のモデルで指示文を作成したり、書き直したりできる。

同じ **Customization** タブでは、次の項目も追加できる。

- **Custom Model**：正確なモデル ID と API の提供元を入力して保存し、トレイメニューの **AI Model** で **Custom Model** を選ぶ。
- **Custom Languages**：言語名を一行に一つずつ入力して保存する。**Primary** と **Secondary** のメニューから選べるようになる。

## 困ったとき

| 症状                                            | 確認すること                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ショートカットが反応しない                      | Honyo が起動中で、**Pause Translation** が無効になっており、文章をコピーできているか確認する。macOS では、起動しているアプリにアクセシビリティ権限を与える。 |
| ChatGPT にログインしたのに API キーを求められる | **AI Model** で末尾が **(ChatGPT)** のモデルを選ぶ。                                                                                                         |
| 翻訳に失敗する                                  | 接続状態、モデルの利用権限、そのモデルで使うアカウントの利用上限や支払い状況を確認する。                                                                     |
| ポップアップが表示されない                      | **Display Mode → Popup Window** を選ぶ。初期設定は **Notification & Copy** になっている。                                                                    |
| ネイティブモジュールのビルドに失敗する          | OS ごとのビルド要件を確認する。macOS では Xcode Command Line Tools と Node.js の開発用ヘッダーを確認する。                                                   |

ローカルでパッケージ化した macOS アプリをビルドし直した後、アクセシビリティ権限を繰り返し求められる場合は、保存された権限をリセットする。

```bash
tccutil reset Accessibility com.rot1024.honyo
```

その後、ビルドし直した Honyo を起動し、アクセシビリティ設定で再び有効にする。このバンドル ID は、現在この派生版でも使われているものだ。

## ローカルに保存する情報

設定と API キーは、アプリのローカルデータディレクトリに保存する。API キーは暗号化されていない JSON として `apikeys.json` に保存する。Codex 用のローカルデータには、その中の `codex` ディレクトリを使う。

コンソール出力にはコピーした文章の一部が含まれることがある。不具合報告でログを共有する際は、非公開の文章と認証情報を取り除く。

## ソースの更新

Honyo を終了し、リポジトリのディレクトリで次を実行する。

```bash
git pull --ff-only
npm ci
npm start
```

アプリ内の更新機能は、現在フォーク元の配布先を参照している。この派生版の更新には、上記のソース更新手順を使う。

## 開発と貢献

| コマンド               | 用途                                   |
| ---------------------- | -------------------------------------- |
| `npm start`            | アプリをビルドして起動する             |
| `npm run typecheck`    | TypeScript の型を検査する              |
| `npm run lint`         | ESLint を実行する                      |
| `npm run format:check` | 書式を検査する                         |
| `npm --silent test`    | 出力を抑えてテストを実行する           |
| `npm run test:verbose` | 詳細な出力でテストを実行する           |
| `npm run test:watch`   | 編集に合わせてテストを実行する         |
| `npm run dist:mac`     | macOS 向けのローカルパッケージを作る   |
| `npm run dist:win`     | Windows 向けのローカルパッケージを作る |
| `npm run dist:linux`   | Linux 向けのローカルパッケージを作る   |

パッケージの出力先は `dist/` になる。対象の OS 上で、その OS のビルドツールを使って作成する。公開設定とリリースの自動処理にはフォーク元の配布先が残っているため、公開する際はこの派生版向けに設定する必要がある。

開発時には、環境変数 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`GOOGLE_API_KEY` でも API キーを指定できる。プロジェクト直下の `.env` ファイルも使える。設定画面で保存したキーが優先される。

不具合は [このリポジトリの Issue](https://github.com/masakiaota/honyo/issues) に、OS、リビジョン、再現手順を添えて報告できる。[プルリクエスト](https://github.com/masakiaota/honyo/pulls)による貢献も歓迎する。

正本は [英語の README.md](README.md) だ。文書を変更する際は英語版を先に更新し、同じ変更で日本語版にも反映する。

## 謝辞とライセンス

このプロジェクトは、rot1024 が作成した [Honyo](https://github.com/eukarya-inc/honyo) をもとにしている。Honyo を開発し、公開してきた原作者と貢献者に感謝する。

元の著作権表示を保持し、[MIT ライセンス](LICENSE)で配布する。
