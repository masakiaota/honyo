export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rectangle extends Point, Size {}

export interface PopupPlacementOptions {
  selectionBounds: Rectangle | null;
  cursorPoint: Point;
  cursorWorkArea: Rectangle;
  workAreas: Rectangle[];
  popupSize: Size;
}

const POPUP_CURSOR_GAP = 16;
const POPUP_SCREEN_PADDING = 10;

interface PositionRange {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function hasPositiveSize(bounds: Rectangle): boolean {
  return bounds.width > 0 && bounds.height > 0;
}

function intersection(first: Rectangle, second: Rectangle): Rectangle | null {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  const width = right - x;
  const height = bottom - y;

  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function intersectionArea(first: Rectangle, second: Rectangle): number {
  const overlap = intersection(first, second);
  return overlap ? overlap.width * overlap.height : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function getPositionRange(workArea: Rectangle, popupSize: Size): PositionRange {
  return {
    minX: workArea.x + POPUP_SCREEN_PADDING,
    minY: workArea.y + POPUP_SCREEN_PADDING,
    maxX: workArea.x + workArea.width - popupSize.width - POPUP_SCREEN_PADDING,
    maxY: workArea.y + workArea.height - popupSize.height - POPUP_SCREEN_PADDING,
  };
}

function fits(candidate: Point, range: PositionRange): boolean {
  return (
    range.minX <= range.maxX &&
    range.minY <= range.maxY &&
    candidate.x >= range.minX &&
    candidate.x <= range.maxX &&
    candidate.y >= range.minY &&
    candidate.y <= range.maxY
  );
}

function clampCandidate(candidate: Point, range: PositionRange): Point {
  return {
    x: clamp(candidate.x, range.minX, range.maxX),
    y: clamp(candidate.y, range.minY, range.maxY),
  };
}

function getCursorPlacement(cursorPoint: Point, workArea: Rectangle, popupSize: Size): Point {
  const range = getPositionRange(workArea, popupSize);
  let x = cursorPoint.x + POPUP_CURSOR_GAP;
  let y = cursorPoint.y + POPUP_CURSOR_GAP;

  if (x > range.maxX) x = cursorPoint.x - popupSize.width - POPUP_CURSOR_GAP;
  if (y > range.maxY) y = cursorPoint.y - popupSize.height - POPUP_CURSOR_GAP;

  return clampCandidate({ x, y }, range);
}

function getSelectionCandidates(
  selection: Rectangle,
  popupSize: Size,
  range: PositionRange,
): [Point, Point, Point, Point] {
  return [
    {
      x: selection.x + selection.width + POPUP_CURSOR_GAP,
      y: clamp(selection.y, range.minY, range.maxY),
    },
    {
      x: selection.x - popupSize.width - POPUP_CURSOR_GAP,
      y: clamp(selection.y, range.minY, range.maxY),
    },
    {
      x: clamp(selection.x, range.minX, range.maxX),
      y: selection.y + selection.height + POPUP_CURSOR_GAP,
    },
    {
      x: clamp(selection.x, range.minX, range.maxX),
      y: selection.y - popupSize.height - POPUP_CURSOR_GAP,
    },
  ];
}

function getSelectionPlacement(
  visibleSelection: Rectangle,
  workArea: Rectangle,
  popupSize: Size,
): Point {
  const range = getPositionRange(workArea, popupSize);
  const candidates = getSelectionCandidates(visibleSelection, popupSize, range);

  for (const candidate of candidates) {
    const popupBounds = { ...candidate, ...popupSize };
    if (fits(candidate, range) && intersectionArea(popupBounds, visibleSelection) === 0) {
      return candidate;
    }
  }

  let bestCandidate = clampCandidate(candidates[0], range);
  let smallestOverlap = intersectionArea({ ...bestCandidate, ...popupSize }, visibleSelection);
  for (const candidate of candidates.slice(1)) {
    const clampedCandidate = clampCandidate(candidate, range);
    const overlap = intersectionArea({ ...clampedCandidate, ...popupSize }, visibleSelection);
    if (overlap < smallestOverlap) {
      bestCandidate = clampedCandidate;
      smallestOverlap = overlap;
    }
  }

  return bestCandidate;
}

export function getSelectionWorkAreaIndex(
  selectionBounds: Rectangle | null,
  workAreas: Rectangle[],
): number | null {
  if (!selectionBounds || !hasPositiveSize(selectionBounds)) return null;

  let selectedIndex: number | null = null;
  let largestIntersectionArea = 0;
  for (const [index, workArea] of workAreas.entries()) {
    const area = intersectionArea(selectionBounds, workArea);
    if (area > largestIntersectionArea) {
      selectedIndex = index;
      largestIntersectionArea = area;
    }
  }

  return selectedIndex;
}

export function getPopupPlacement({
  selectionBounds,
  cursorPoint,
  cursorWorkArea,
  workAreas,
  popupSize,
}: PopupPlacementOptions): Point {
  const selectionWorkAreaIndex = getSelectionWorkAreaIndex(selectionBounds, workAreas);
  if (selectionWorkAreaIndex === null || !selectionBounds) {
    return getCursorPlacement(cursorPoint, cursorWorkArea, popupSize);
  }

  const workArea = workAreas[selectionWorkAreaIndex];
  if (!workArea) return getCursorPlacement(cursorPoint, cursorWorkArea, popupSize);
  const visibleSelection = intersection(selectionBounds, workArea);
  return visibleSelection
    ? getSelectionPlacement(visibleSelection, workArea, popupSize)
    : getCursorPlacement(cursorPoint, cursorWorkArea, popupSize);
}
