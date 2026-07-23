import { BrowserWindow, ipcMain, app } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateText } from 'ai';
import {
  getApiKeys,
  updateApiKeys,
  getConfig,
  updateConfig,
  clearPopupSize,
  type ApiKeys,
  type Config,
  type CustomModel,
} from '../config/index.ts';
import { resetPopupSize } from './popup.ts';
import { getAIProvider } from '../translation/providers.ts';
import { CUSTOM_MODEL_ID } from '../models.ts';
import { getModelInfo, refreshModels } from '../models-remote.ts';

// Get __dirname in both ESM and CommonJS
const getCurrentDir = (): string => {
  if (typeof import.meta.url !== 'undefined') {
    // ESM
    return dirname(fileURLToPath(import.meta.url));
  } else {
    // CommonJS
    return __dirname;
  }
};

const currentDir = getCurrentDir();

let settingsWindow: BrowserWindow | null = null;

export function openSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    resizable: true,
    minimizable: true,
    maximizable: true,
    title: 'Settings',
  });

  const htmlPath = join(currentDir, '../../settings.html');
  void settingsWindow.loadFile(htmlPath);

  // Refresh the model list when settings open (respects the 24h cache TTL);
  // rebuilds the tray menu automatically if the list changed.
  void refreshModels();

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

export function setupSettingsIPC(): void {
  ipcMain.on('load-api-keys', event => {
    event.reply('api-keys-loaded', getApiKeys());
  });

  ipcMain.on('save-api-keys', (event, keys: Partial<ApiKeys>) => {
    updateApiKeys(keys);
    event.reply('api-keys-saved', true);
  });

  ipcMain.on('load-custom-prompt', event => {
    const config = getConfig();
    event.reply('custom-prompt-loaded', config.customPrompt);
  });

  ipcMain.on('save-custom-prompt', (event, customPrompt: string) => {
    updateConfig({ customPrompt });
    event.reply('custom-prompt-saved', true);
  });

  ipcMain.on('load-custom-model', event => {
    const config = getConfig();
    event.reply('custom-model-loaded', config.customModel);
  });

  ipcMain.on('save-custom-model', (event, customModel: CustomModel) => {
    updateConfig({ customModel });
    event.reply('custom-model-saved', true);
  });

  ipcMain.on('load-custom-languages', event => {
    const config = getConfig();
    event.reply('custom-languages-loaded', config.customLanguages || []);
  });

  ipcMain.on('save-custom-languages', (event, customLanguages: string[]) => {
    updateConfig({ customLanguages });
    event.reply('custom-languages-saved', true);
  });

  ipcMain.on('load-auto-close-on-blur', event => {
    const config = getConfig();
    event.reply('auto-close-on-blur-loaded', config.autoCloseOnBlur ?? true);
    event.reply('enable-streaming-loaded', config.enableStreaming ?? true);
    event.reply('popup-font-size-loaded', config.popupFontSize ?? 14);
  });

  ipcMain.on('save-auto-close-on-blur', (event, autoCloseOnBlur: boolean) => {
    updateConfig({ autoCloseOnBlur });
    event.reply('auto-close-on-blur-saved', true);
  });

  ipcMain.on(
    'save-display-settings',
    (
      event,
      settings: { autoCloseOnBlur: boolean; enableStreaming: boolean; popupFontSize?: number },
    ) => {
      const updates: Partial<Config> = {
        autoCloseOnBlur: settings.autoCloseOnBlur,
        enableStreaming: settings.enableStreaming,
      };
      if (typeof settings.popupFontSize === 'number' && !Number.isNaN(settings.popupFontSize)) {
        updates.popupFontSize = Math.min(24, Math.max(10, Math.round(settings.popupFontSize)));
      }
      updateConfig(updates);
      event.reply('display-settings-saved', true);
    },
  );

  ipcMain.on('reset-popup-size', event => {
    clearPopupSize();
    // Resize the popup immediately if one is currently open.
    resetPopupSize();
    event.reply('popup-size-reset', true);
  });

  ipcMain.on('load-open-at-login', event => {
    const loginSettings = app.getLoginItemSettings();
    event.reply('open-at-login-loaded', loginSettings.openAtLogin);
  });

  ipcMain.on('save-open-at-login', (event, openAtLogin: boolean) => {
    app.setLoginItemSettings({ openAtLogin });
    updateConfig({ openAtLogin });
    event.reply('open-at-login-saved', true);
  });

  ipcMain.on(
    'generate-custom-prompt',
    (event, data: { currentPrompt: string; instruction: string }) => {
      void (async (): Promise<void> => {
        try {
          const config = getConfig();
          const apiKeys = getApiKeys();

          // Validate API key
          let apiKey: string | undefined;
          if (config.aiModel === CUSTOM_MODEL_ID) {
            if (!config.customModel?.provider) {
              event.reply('custom-prompt-generated', {
                success: false,
                error: 'Custom model not configured',
              });
              return;
            }
            apiKey = apiKeys[config.customModel.provider];
          } else {
            const modelInfo = getModelInfo(config.aiModel);
            if (modelInfo) {
              apiKey = apiKeys[modelInfo.provider];
            }
          }

          if (!apiKey) {
            event.reply('custom-prompt-generated', {
              success: false,
              error: 'API key not configured',
            });
            return;
          }

          const model = getAIProvider(config.aiModel, apiKeys, config.customModel);

          const systemPrompt = `You are an expert at writing translation instruction prompts.
Your task is to generate or modify a custom prompt that will be used to guide AI translations.

Rules:
1. Output ONLY the custom prompt text, no explanations or meta-commentary
2. Write the prompt in English for best results
3. Keep instructions clear, concise, and actionable
4. Focus on translation style, tone, terminology preferences, etc.
5. If there's an existing prompt, improve or modify it based on the user's request
6. If no existing prompt, create a new one based on the user's request`;

          const userPrompt = data.currentPrompt
            ? `Current custom prompt:\n${data.currentPrompt}\n\nUser's request: ${data.instruction}`
            : `User's request: ${data.instruction}`;

          const { text } = await generateText({
            model,
            system: systemPrompt,
            prompt: userPrompt,
          });

          event.reply('custom-prompt-generated', {
            success: true,
            prompt: text.trim(),
          });
        } catch (error) {
          console.error('Failed to generate custom prompt:', error);
          event.reply('custom-prompt-generated', {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })();
    },
  );
}
