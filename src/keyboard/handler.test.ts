import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  keydown: undefined as
    | ((event: { keycode: number; metaKey: boolean; ctrlKey: boolean }) => void)
    | undefined,
  clipboard: 'Hello',
  config: {
    displayMode: 'popup',
    enableStreaming: true,
    maxInputCharacters: 4096,
    targetLanguage: 'Japanese',
    secondaryLanguage: 'English',
  } as Record<string, unknown>,
  stream: vi.fn(),
  detailed: vi.fn(),
  show: vi.fn(),
  close: vi.fn(),
  chunk: vi.fn(),
  langs: vi.fn(),
  finalize: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('uiohook-napi', () => ({
  UiohookKey: { C: 46 },
  uIOhook: {
    on: (_event: string, listener: typeof fake.keydown): void => {
      fake.keydown = listener;
    },
  },
}));
vi.mock('electron', () => ({
  clipboard: {
    readText: (): Promise<string> => Promise.resolve(fake.clipboard),
    writeText: vi.fn(),
  },
  Notification: class {
    show(): void {
      fake.notify();
    }
  },
}));
vi.mock('../translation/index.ts', () => ({
  translateTextStreaming: fake.stream,
  translateTextDetailed: fake.detailed,
}));
vi.mock('../config/index.ts', () => ({
  getConfig: (): Record<string, unknown> => fake.config,
  getPausedState: (): boolean => false,
}));
vi.mock('../ui/tray.ts', () => ({ setTrayIcon: vi.fn() }));
vi.mock('../ui/popup.ts', () => ({
  showTranslationPopup: fake.show,
  closePopup: fake.close,
  updatePopupTranslation: fake.chunk,
  updatePopupLanguages: fake.langs,
  finalizePopupTranslation: fake.finalize,
}));

import { cancelCurrentTranslation, setupKeyboardHandler } from './handler.ts';

setupKeyboardHandler();

function doubleCopy(): void {
  fake.keydown?.({ keycode: 46, metaKey: true, ctrlKey: true });
  fake.keydown?.({ keycode: 46, metaKey: true, ctrlKey: true });
}
function abortable(): Promise<string> {
  return new Promise<string>((_resolve, reject) => {
    const signal = fake.stream.mock.lastCall?.[4] as AbortSignal;
    signal.addEventListener('abort', () =>
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  fake.clipboard = 'Hello';
  fake.config.displayMode = 'popup';
  fake.config.enableStreaming = true;
  for (const mock of [
    fake.stream,
    fake.detailed,
    fake.show,
    fake.close,
    fake.chunk,
    fake.langs,
    fake.finalize,
    fake.notify,
  ])
    mock.mockReset();
});
afterEach(() => {
  cancelCurrentTranslation();
  vi.useRealTimers();
});

it('does not let a replaced request close or overwrite the new popup', async () => {
  fake.stream.mockImplementationOnce(abortable);
  doubleCopy();
  await vi.advanceTimersByTimeAsync(60);
  expect(fake.show).toHaveBeenCalledOnce();
  const second = Promise.withResolvers<string>();
  fake.stream.mockImplementationOnce(() => second.promise);
  vi.setSystemTime(20_000);
  doubleCopy();
  await vi.advanceTimersByTimeAsync(60);
  expect(fake.close).not.toHaveBeenCalled();
  expect(fake.finalize).not.toHaveBeenCalled();
  expect(fake.show).toHaveBeenCalledTimes(2);
  second.resolve('こんにちは');
  await vi.advanceTimersByTimeAsync(0);
  expect(fake.finalize).toHaveBeenCalledExactlyOnceWith('こんにちは');
});

it('shows an immediate error in the popup it opened', async () => {
  fake.stream.mockRejectedValueOnce(new Error('Enter text to translate.'));
  doubleCopy();
  await vi.advanceTimersByTimeAsync(60);
  expect(fake.finalize).toHaveBeenCalledExactlyOnceWith('Enter text to translate.');
});

it('finishes its popup even if the display mode changes mid-request', async () => {
  const pending = Promise.withResolvers<string>();
  fake.stream.mockImplementationOnce(() => pending.promise);
  doubleCopy();
  await vi.advanceTimersByTimeAsync(60);
  fake.config.displayMode = 'notification';
  pending.reject(new Error('timed out'));
  await vi.advanceTimersByTimeAsync(0);
  expect(fake.finalize).toHaveBeenCalledExactlyOnceWith('timed out');
});

it('starts only the latest of double copies that arrive before the start delay', async () => {
  fake.stream.mockResolvedValue('訳');
  doubleCopy();
  vi.setSystemTime(10_900);
  fake.clipboard = 'Second';
  doubleCopy();
  await vi.advanceTimersByTimeAsync(60);
  expect(fake.stream).toHaveBeenCalledOnce();
  expect(fake.stream.mock.lastCall?.[0]).toBe('Second');
});

it('ignores whitespace-only clipboard text without opening a popup', async () => {
  fake.clipboard = ' \n\t';
  doubleCopy();
  await vi.advanceTimersByTimeAsync(60);
  expect(fake.show).not.toHaveBeenCalled();
  expect(fake.stream).not.toHaveBeenCalled();
});
