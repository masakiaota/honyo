# Honyo

English (canonical) | [日本語](README.ja.md)

<img src="assets/icon.svg" width="96" height="96" alt="Honyo icon">

**Select text, hold Command (Ctrl on Windows/Linux), and press C twice quickly to translate.**

Honyo is a desktop translation app with a **DeepL-style workflow**. It translates selected text with your chosen AI model and displays the result in a popup or notification.

This is [masakiaota's fork](https://github.com/masakiaota/honyo) of [eukarya-inc/honyo](https://github.com/eukarya-inc/honyo), with ChatGPT sign-in and model-specific reasoning and Fast mode settings.

![Honyo popup window and tray menu](assets/screenshot.png)

## Highlights

- **Translate with your ChatGPT account.** Sign in to use models available to your account through Codex, without setting up an API key.
- **Choose reasoning effort and Fast mode.** Combining lightweight models with lower reasoning can deliver faster responses.
- **Choose your AI provider.** Use Claude, GPT, or Gemini with an API key. The API model list refreshes automatically from public catalogs.
- **Translate in both directions.** Honyo chooses between your primary and secondary languages based on the source text. Back-translation helps you review the result.
- **Set your translation style.** Add instructions for terminology and tone, or use AI to help write those instructions.

## Requirements and usage

Translation requires an internet connection and one of these connections:

| Connection      | What you need                                                        | Usage and billing                                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT sign-in | A ChatGPT account with access to Codex                               | Translations use your Codex allowance. Available models and limits depend on your account. See [Codex pricing and limits](https://learn.chatgpt.com/docs/pricing).                                                  |
| API key         | A key with access to the selected Anthropic, OpenAI, or Google model | The provider's API rates and limits apply. OpenAI API usage is billed separately from a ChatGPT subscription. See [OpenAI authentication and billing](https://learn.chatgpt.com/docs/auth#sign-in-with-an-api-key). |

Translation sends the source text and any custom instructions to the selected AI service. Its data-handling policies apply.

## Run from source

This fork currently has no packaged releases. Build and run it from this repository.

### Build prerequisites

Install Git, **Node.js 23.6.0 or newer**, and npm. Native modules also need the tools below; see the [node-gyp installation guide](https://github.com/nodejs/node-gyp#installation) for setup details.

| Platform | Native build tools                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | Python 3 and Xcode Command Line Tools (`xcode-select --install`). Your Node.js installation must include its development headers. |
| Windows  | Python 3 and Visual Studio 2022 with the **Desktop development with C++** workload.                                               |
| Linux    | Python 3, `make`, a C/C++ compiler, and X11 development libraries.                                                                |

<details>
<summary>Debian/Ubuntu build dependencies</summary>

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3 \
  libx11-dev libxtst-dev libxt-dev libx11-xcb-dev \
  libxkbcommon-dev libxkbcommon-x11-dev libxrandr-dev \
  libxinerama-dev libxcursor-dev libxi-dev
```

</details>

### Start Honyo

```bash
git clone https://github.com/masakiaota/honyo.git
cd honyo
npm ci
npm start
```

`npm start` builds the app before launching it. Honyo runs in the system tray or macOS menu bar; open its menu to access settings.

On macOS, allow the app under **System Settings → Privacy & Security → Accessibility** so it can detect the shortcut. When running with `npm start`, the app is Electron. Enable the corresponding Electron entry and run `npm start` again after granting permission.

## Your first translation

### Connect with ChatGPT

1. Open the tray menu → **Settings... → API Keys**.
2. In **ChatGPT/Codex**, select **Sign in with ChatGPT** and complete the browser sign-in.
3. Return to Honyo, open the tray's **AI Model** menu, and select a model whose name ends in **(ChatGPT)**.

The **(ChatGPT)** suffix identifies models that use your Codex access. Other provider entries use API keys.

### Connect with an API key

1. Obtain a key from [Anthropic Console](https://console.anthropic.com/), [OpenAI Platform](https://platform.openai.com/api-keys), or [Google AI Studio](https://aistudio.google.com/apikey).
2. Open **Settings... → API Keys**, enter the key in the matching provider field, and select **Save**.
3. Choose a model from that provider in the tray's **AI Model** menu.

### Translate

1. Set **Primary** to the language you usually want to read and **Secondary** to the other language you use.
2. Choose a **Display Mode** from the tray menu. Select **Popup Window** to read and review translations, or **Notification & Copy** to copy results automatically.
3. Select text and press **Cmd+C twice** on macOS or **Ctrl+C twice** on Windows and Linux, in quick succession.

Text in your primary language is translated into your secondary language. Text in another language is translated into your primary language. For example, with Japanese as primary and English as secondary, English text becomes Japanese and Japanese text becomes English.

| Display mode        | What happens                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popup Window        | Shows the translation and language direction. Use **⇄** to back-translate for review. Press **Enter** or select **Copy** to copy and close; press **Escape** to close. |
| Notification & Copy | Shows a system notification and replaces the clipboard contents with the translation. This is the default mode.                                                        |

Use **Pause Translation** in the tray menu to temporarily disable the shortcut, or **Stop Current Translation** to cancel a request.

## Model and translation settings

### Reasoning effort and Fast mode

Select a model in the tray menu, then open **Settings... → Model**:

- **Reasoning effort** sets how much reasoning the model should use. Leave **Use the model default** selected to use its default behavior.
- **Use Fast mode** requests faster processing when the selected model supports it.

Select **Save** to save these preferences for the selected model. Availability depends on the model; ChatGPT model options come from your account's model catalog.

Fast mode consumes more of your Codex allowance when using ChatGPT. For supported OpenAI API models, it uses Priority processing with separate API rates. See [OpenAI's Fast mode and billing guidance](https://learn.chatgpt.com/docs/agent-configuration/speed).

### Translation instructions

Open **Settings... → Customization → Custom Prompt** to add instructions included in every translation, then select **Save**. For example:

```text
Keep product names in their original language.
Use consistent terminology for software development.
Use a formal tone.
```

**Generate with AI** can write or refine the instructions using your selected model.

The same **Customization** tab lets you add:

- **Custom Model:** enter an exact model ID and its API provider, save, then choose **Custom Model** in the tray's **AI Model** menu.
- **Custom Languages:** enter one language name per line and save. They become available in the **Primary** and **Secondary** menus.

## Troubleshooting

| Symptom                                               | What to check                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The shortcut does nothing                             | Confirm Honyo is running, **Pause Translation** is off, and the text was copied. On macOS, grant Accessibility permission to the app you are running. |
| An API key is requested after signing in with ChatGPT | Select a model ending in **(ChatGPT)** in **AI Model**.                                                                                               |
| Translation fails                                     | Check your connection, model access, and the usage limit or billing status of the account used for that model.                                        |
| The popup does not appear                             | Select **Display Mode → Popup Window**. The default is **Notification & Copy**.                                                                       |
| A native module fails to build                        | Check the platform prerequisites above. On macOS, verify that Xcode Command Line Tools and Node.js development headers are installed.                 |

If a locally packaged macOS app keeps requesting Accessibility permission after a rebuild, reset its stored permission:

```bash
tccutil reset Accessibility com.rot1024.honyo
```

Then launch the rebuilt Honyo app and enable it again in Accessibility settings. The bundle ID above is the one currently used by this fork.

## Local data

Settings and API keys are stored in the app's local data directory. API keys are saved in `apikeys.json` as unencrypted JSON. Codex uses the `codex` subdirectory for its local data.

Console output can include excerpts of copied text. Remove private text and credentials before sharing logs in an issue.

## Update from source

Quit Honyo, then run these commands in your checkout:

```bash
git pull --ff-only
npm ci
npm start
```

The in-app updater currently points to the original project's releases. Use the source update procedure above for this fork.

## Development and contributions

| Command                | Purpose                        |
| ---------------------- | ------------------------------ |
| `npm start`            | Build and run the app          |
| `npm run typecheck`    | Check TypeScript types         |
| `npm run lint`         | Run ESLint                     |
| `npm run format:check` | Check formatting               |
| `npm --silent test`    | Run tests with compact output  |
| `npm run test:verbose` | Run tests with detailed output |
| `npm run test:watch`   | Run tests while editing        |
| `npm run dist:mac`     | Build a local macOS package    |
| `npm run dist:win`     | Build a local Windows package  |
| `npm run dist:linux`   | Build a local Linux package    |

Packaging outputs go to `dist/`. Build on the target OS with its native build tools. Publishing settings and release automation still contain upstream destinations and need to be configured for this fork before publishing.

For development, API keys can also be set through `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_API_KEY`, including in a `.env` file at the project root. Keys saved in Settings take precedence.

Report bugs in [this repository's issues](https://github.com/masakiaota/honyo/issues), including the OS, revision, and reproduction steps. Contributions are welcome through [pull requests](https://github.com/masakiaota/honyo/pulls).

This English README is the canonical version. Update it first and keep [README.ja.md](README.ja.md) in sync in the same change.

## Acknowledgments and license

This project is based on [Honyo](https://github.com/eukarya-inc/honyo), originally created by rot1024. Thanks to the original author and contributors for building and sharing Honyo.

Distributed under the [MIT License](LICENSE), with the original copyright notice retained.
