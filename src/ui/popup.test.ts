import { beforeEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  windows: [] as unknown[],
  translate: vi.fn(),
  ipc: new Map<string, (...args: unknown[]) => void>(),
  FakeWindow: undefined as unknown as new () => unknown,
}));

interface FakeWindow {
  webContents: {
    sent: [string, ...unknown[]][];
    emit(event: string): boolean;
  };
}

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeWebContents extends EventEmitter {
    readonly sent: [string, ...unknown[]][] = [];
    send(channel: string, ...args: unknown[]): void {
      this.sent.push([channel, ...args]);
    }
    setWindowOpenHandler(): void {}
  }

  class FakeWindow extends EventEmitter {
    readonly webContents = new FakeWebContents();
    destroyed = false;
    constructor() {
      super();
      fake.windows.push(this);
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    setAlwaysOnTop(): void {}
    getSize(): number[] {
      return [400, 200];
    }
    setPosition(): void {}
    setSize(): void {}
    loadFile(): Promise<void> {
      return Promise.resolve();
    }
    focus(): void {}
    close(): void {
      this.destroyed = true;
      this.emit('closed');
    }
  }
  fake.FakeWindow = FakeWindow;
  const display = { workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  return {
    app: { isPackaged: false },
    BrowserWindow: FakeWindow,
    screen: {
      getCursorScreenPoint: (): { x: number; y: number } => ({ x: 10, y: 10 }),
      getAllDisplays: (): (typeof display)[] => [display],
      getDisplayNearestPoint: (): typeof display => display,
    },
    ipcMain: {
      on: (channel: string, listener: (...args: unknown[]) => void): void => {
        fake.ipc.set(channel, listener);
      },
    },
    clipboard: { writeText: vi.fn() },
    Menu: { buildFromTemplate: vi.fn() },
  };
});
vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('./selection-anchor.ts', () => ({ getSelectionBounds: (): null => null }));
vi.mock('../keyboard/handler.ts', () => ({ cancelCurrentTranslation: vi.fn() }));
vi.mock('../translation/index.ts', () => ({ translateTextDetailed: fake.translate }));
vi.mock('../config/index.ts', () => ({
  getConfig: (): Record<string, unknown> => ({
    autoCloseOnBlur: false,
    autoCloseAfterFiveMinutes: false,
    popupFontSize: 14,
    targetLanguage: 'Japanese',
    secondaryLanguage: 'English',
  }),
  updateConfig: vi.fn(),
}));

import {
  closePopup,
  finalizePopupTranslation,
  setupPopupIPC,
  showTranslationPopup,
  updatePopupLanguages,
  updatePopupTranslation,
} from './popup.ts';

setupPopupIPC();

function latest(): FakeWindow {
  const window = fake.windows.at(-1);
  if (!window) throw new Error('No popup window');
  return window as FakeWindow;
}
function contentMessages(window: FakeWindow): unknown[][] {
  return window.webContents.sent.filter(
    ([channel]) => channel.startsWith('translation-') || channel.startsWith('back-'),
  );
}

beforeEach(() => {
  closePopup(false);
  fake.translate.mockReset();
});

it('replays an error that finished before the new popup loaded instead of the loading state', () => {
  showTranslationPopup(null, 'Hello');
  const window = latest();
  finalizePopupTranslation('The offline model is busy.');
  expect(contentMessages(window)).toEqual([]);
  window.webContents.emit('did-finish-load');
  expect(contentMessages(window)).toEqual([['translation-complete', 'The offline model is busy.']]);
});

it('replays the latest cumulative chunk and language pair after loading', () => {
  showTranslationPopup(null, 'Hello');
  const window = latest();
  updatePopupLanguages('English', 'Japanese');
  updatePopupTranslation('こん');
  updatePopupTranslation('こんにちは');
  window.webContents.emit('did-finish-load');
  expect(contentMessages(window)).toEqual([
    ['translation-chunk', 'こんにちは'],
    ['translation-langs', { sourceLanguage: 'English', targetLanguage: 'Japanese' }],
  ]);
});

it('sends content directly once the popup is ready', () => {
  showTranslationPopup(null, 'Hello');
  const window = latest();
  window.webContents.emit('did-finish-load');
  showTranslationPopup(null, 'Next');
  finalizePopupTranslation('done');
  expect(contentMessages(window)).toEqual([
    ['translation-loading'],
    ['translation-loading'],
    ['translation-complete', 'done'],
  ]);
});

it('cancels a running back-translation when a new translation starts', async () => {
  let signal: AbortSignal | undefined;
  fake.translate.mockImplementation(
    (_text: string, _primary: string, _secondary: string, value: AbortSignal) => {
      signal = value;
      return new Promise((_resolve, reject) =>
        value.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    },
  );
  showTranslationPopup(null, 'Hello');
  const window = latest();
  window.webContents.emit('did-finish-load');
  fake.ipc.get('back-translate')?.({ sender: window.webContents }, 'こんにちは');
  expect(signal?.aborted).toBe(false);
  showTranslationPopup(null, 'Next');
  expect(signal?.aborted).toBe(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(window.webContents.sent.some(([channel]) => channel === 'back-translation-error')).toBe(
    false,
  );
});
