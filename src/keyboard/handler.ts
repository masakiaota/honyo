import { clipboard, Notification } from 'electron';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { translateTextDetailed, translateTextStreaming } from '../translation/index.ts';
import { getConfig, getPausedState } from '../config/index.ts';
import {
  exceedsInputCharacterLimit,
  getInputCharacterLimitMessage,
} from '../input-character-limit.ts';
import { setTrayIcon } from '../ui/tray.ts';
import {
  showTranslationPopup,
  updatePopupTranslation,
  updatePopupLanguages,
  finalizePopupTranslation,
} from '../ui/popup.ts';

let t = 0;
let n = 0;
// The running translation. Only it may touch the popup; a replaced or closed
// request is aborted and cleans up nothing but its own state.
let currentAbortController: AbortController | null = null;
// Only the latest double copy may start, and it replaces the running
// translation only once its input is valid.
let latestStartId = 0;
let pendingStart: ReturnType<typeof setTimeout> | undefined;

export function setupKeyboardHandler(): void {
  uIOhook.on('keydown', e => {
    const isC = e.keycode === UiohookKey.C;
    const meta = process.platform === 'darwin' ? e.metaKey : e.ctrlKey;
    if (!(isC && meta)) return;

    const now = Date.now();
    n = now - t < 800 ? n + 1 : 1;
    t = now;

    if (n === 2) {
      console.log('Double copy detected');

      // Ignore if paused
      if (getPausedState()) {
        console.log('Translation is paused, ignoring...');
        n = 0;
        return;
      }

      const startId = ++latestStartId;
      clearTimeout(pendingStart);
      pendingStart = setTimeout(() => {
        pendingStart = undefined;
        if (startId !== latestStartId) return;
        void (async (): Promise<void> => {
          // Create new AbortController for this translation
          const abortController = new AbortController();
          const isCurrent = (): boolean => currentAbortController === abortController;
          // The display mode is fixed per request so that a mode change cannot
          // skip finishing a popup this request already opened.
          const config = getConfig();

          // Wait for copy to complete
          try {
            const text = await clipboard.readText();
            console.log('Clipboard content:', text ? text.slice(0, 50) + '...' : '(empty)');

            // Superseded or closed while reading; an empty copy keeps the current translation.
            if (startId !== latestStartId || !text.trim()) {
              return; // Do nothing
            }

            const limit = config.maxInputCharacters;
            if (exceedsInputCharacterLimit(text, limit)) {
              new Notification({
                title: 'Input Character Limit Exceeded',
                body: getInputCharacterLimitMessage(limit),
              }).show();
              return;
            }

            // Replace the current translation only now that this request will start.
            abortActiveTranslation();
            setTrayIcon(true);

            // Set current abort controller
            currentAbortController = abortController;
            const signal = abortController.signal;

            // Show popup immediately with loading state if in popup mode
            if (config.displayMode === 'popup') {
              showTranslationPopup(null, text);
            }

            let translation: string;
            // Detected language pair (non-streaming path); streaming emits it
            // via the onLanguages callback below.
            let detectedLanguages: { source: string; target: string } | null = null;

            // Use streaming for popup mode if enabled
            if (config.displayMode === 'popup' && config.enableStreaming) {
              translation = await translateTextStreaming(
                text,
                config.targetLanguage,
                config.secondaryLanguage,
                (chunk: string) => {
                  if (isCurrent()) updatePopupTranslation(chunk);
                },
                signal,
                (source: string, target: string) => {
                  if (isCurrent()) updatePopupLanguages(source, target);
                },
              );
              // Notify that streaming is complete
              if (isCurrent()) finalizePopupTranslation(translation);
            } else {
              const result = await translateTextDetailed(
                text,
                config.targetLanguage,
                config.secondaryLanguage,
                signal,
              );
              translation = result.translation;
              if (result.sourceLanguage && result.targetLanguage) {
                detectedLanguages = {
                  source: result.sourceLanguage,
                  target: result.targetLanguage,
                };
              }
            }

            if (!isCurrent()) return;
            // Handle display mode
            if (config.displayMode === 'popup') {
              // Update popup window with final translation (in case streaming didn't run)
              if (!config.enableStreaming) {
                showTranslationPopup(translation, text);
                if (detectedLanguages) {
                  updatePopupLanguages(detectedLanguages.source, detectedLanguages.target);
                }
              }
            } else {
              // Notification mode: copy to clipboard and show notification
              await clipboard.writeText(translation);
              new Notification({
                title: 'Translation Result',
                body: translation.length > 100 ? translation.slice(0, 100) + '...' : translation,
              }).show();
            }
          } catch (error) {
            // A replaced or closed request must not touch the popup.
            if (abortController.signal.aborted) {
              console.log('Translation was cancelled');
            } else {
              console.error('Error in translation process:', error);
              if (isCurrent() && config.displayMode === 'popup')
                finalizePopupTranslation(
                  error instanceof Error ? error.message : 'Translation failed',
                );
              new Notification({
                title: 'Translation Error',
                body: error instanceof Error ? error.message : 'Failed to translate.',
              }).show();
            }
          } finally {
            // Translation complete - only reset state if this is still the current translation
            if (isCurrent()) {
              setTrayIcon(false);
              currentAbortController = null;
            }
          }
        })();
      }, 60);
      n = 0;
    }
  });
}

export function startKeyboardListener(): void {
  try {
    uIOhook.start();
    console.log('Key listener started successfully');
  } catch (error) {
    console.error('Failed to start uIOhook:', error);
    throw error;
  }
}

export function stopKeyboardListener(): void {
  try {
    uIOhook.stop();
  } catch (error) {
    console.error('Error stopping uIOhook:', error);
  }
}

/** Cancels the running translation and any double copy that has not started yet. */
export function cancelCurrentTranslation(): void {
  clearTimeout(pendingStart);
  pendingStart = undefined;
  ++latestStartId;
  abortActiveTranslation();
}

function abortActiveTranslation(): void {
  if (currentAbortController) {
    currentAbortController.abort();
    console.log('Translation cancelled');
    // Reset state immediately to allow new translations
    setTrayIcon(false);
    currentAbortController = null;
  }
}

export function isCurrentlyTranslating(): boolean {
  return currentAbortController !== null;
}
