import { describe, expect, it } from 'vitest';
import {
  getPopupPlacement,
  getSelectionWorkAreaIndex,
  type Point,
  type Rectangle,
} from './popup-placement.ts';

const workArea = { x: 0, y: 0, width: 1_000, height: 800 };
const popupSize = { width: 400, height: 200 };

function place(selectionBounds: Rectangle | null): Point {
  return getPopupPlacement({
    selectionBounds,
    cursorPoint: { x: 500, y: 400 },
    cursorWorkArea: workArea,
    workAreas: [workArea],
    popupSize,
  });
}

describe('getPopupPlacement', () => {
  it('places the popup to the right of a visible selection first', () => {
    expect(place({ x: 100, y: 120, width: 100, height: 20 })).toEqual({ x: 216, y: 120 });
  });

  it('tries the left side when the right side does not fit', () => {
    expect(place({ x: 600, y: 120, width: 300, height: 20 })).toEqual({ x: 184, y: 120 });
  });

  it('tries below before above when neither horizontal side fits', () => {
    expect(place({ x: 100, y: 300, width: 800, height: 20 })).toEqual({ x: 100, y: 336 });
  });

  it('aligns to the padded visible top when a selection begins above the work area', () => {
    expect(place({ x: 200, y: -20, width: 100, height: 100 })).toEqual({ x: 316, y: 10 });
  });

  it('clamps all candidates and chooses the smallest overlap when none fit', () => {
    expect(place({ x: 100, y: 100, width: 800, height: 600 })).toEqual({ x: 100, y: 590 });
  });

  it('uses the display with the greatest selection intersection', () => {
    const secondaryWorkArea = { x: 1_000, y: 0, width: 1_000, height: 800 };
    const selectionBounds = { x: 900, y: 100, width: 300, height: 20 };

    expect(getSelectionWorkAreaIndex(selectionBounds, [workArea, secondaryWorkArea])).toBe(1);
    expect(
      getPopupPlacement({
        selectionBounds,
        cursorPoint: { x: 500, y: 400 },
        cursorWorkArea: workArea,
        workAreas: [workArea, secondaryWorkArea],
        popupSize,
      }),
    ).toEqual({ x: 1_216, y: 100 });
  });

  it('keeps the existing cursor placement when selection bounds are unavailable', () => {
    expect(
      getPopupPlacement({
        selectionBounds: null,
        cursorPoint: { x: 950, y: 760 },
        cursorWorkArea: workArea,
        workAreas: [workArea],
        popupSize,
      }),
    ).toEqual({ x: 534, y: 544 });
  });

  it('falls back to the cursor when the entire selection is offscreen', () => {
    expect(
      getPopupPlacement({
        selectionBounds: { x: 100, y: 900, width: 100, height: 20 },
        cursorPoint: { x: 950, y: 760 },
        cursorWorkArea: workArea,
        workAreas: [workArea],
        popupSize,
      }),
    ).toEqual({ x: 534, y: 544 });
  });
});
