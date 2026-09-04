import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPopupTimerUrgency, POPUP_AUTO_CLOSE_DURATION_MS, PopupTimer } from './popup-timer.ts';

describe('getPopupTimerUrgency', () => {
  it('uses yellow from one minute and red from fifteen seconds', () => {
    expect(getPopupTimerUrgency(61)).toBe('normal');
    expect(getPopupTimerUrgency(60)).toBe('warning');
    expect(getPopupTimerUrgency(16)).toBe('warning');
    expect(getPopupTimerUrgency(15)).toBe('critical');
  });
});

describe('PopupTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires after five minutes', () => {
    const onTick = vi.fn();
    const onExpire = vi.fn();
    const timer = new PopupTimer(onTick, onExpire);

    timer.start();
    expect(onTick).toHaveBeenLastCalledWith(300, 'normal');

    vi.advanceTimersByTime(POPUP_AUTO_CLOSE_DURATION_MS - 1);
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('restarts the full five minutes when extended', () => {
    const onExpire = vi.fn();
    const timer = new PopupTimer(vi.fn(), onExpire);

    timer.start();
    vi.advanceTimersByTime(4 * 60 * 1_000);
    timer.start();

    vi.advanceTimersByTime(60 * 1_000);
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4 * 60 * 1_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not expire after it is stopped', () => {
    const onExpire = vi.fn();
    const timer = new PopupTimer(vi.fn(), onExpire);

    timer.start();
    timer.stop();
    vi.advanceTimersByTime(POPUP_AUTO_CLOSE_DURATION_MS);

    expect(onExpire).not.toHaveBeenCalled();
  });
});
