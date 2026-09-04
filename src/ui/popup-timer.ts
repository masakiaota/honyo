export const POPUP_AUTO_CLOSE_DURATION_MS = 5 * 60 * 1000;

export type PopupTimerUrgency = 'normal' | 'warning' | 'critical';

export function getPopupTimerUrgency(remainingSeconds: number): PopupTimerUrgency {
  if (remainingSeconds <= 15) return 'critical';
  if (remainingSeconds <= 60) return 'warning';
  return 'normal';
}

export class PopupTimer {
  private deadline: number | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onTick: (remainingSeconds: number, urgency: PopupTimerUrgency) => void,
    private readonly onExpire: () => void,
  ) {}

  start(): void {
    this.stop();
    this.deadline = Date.now() + POPUP_AUTO_CLOSE_DURATION_MS;
    this.publish();
    this.interval = setInterval(() => this.publish(), 1_000);
    this.timeout = setTimeout(() => {
      this.stop();
      this.onExpire();
    }, POPUP_AUTO_CLOSE_DURATION_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.deadline = null;
  }

  publish(): void {
    if (this.deadline === null) return;
    const remainingSeconds = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1_000));
    this.onTick(remainingSeconds, getPopupTimerUrgency(remainingSeconds));
  }
}
