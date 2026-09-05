import { app } from 'electron';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Rectangle } from './popup-placement.ts';

export type SelectionBounds = Rectangle;

interface MacOSSelectionAnchor {
  getSelectionBounds(): SelectionBounds | null;
}

const require = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);

let macOSSelectionAnchor: MacOSSelectionAnchor | null | undefined;

function getMacOSSelectionAnchor(): MacOSSelectionAnchor | null {
  if (macOSSelectionAnchor !== undefined) return macOSSelectionAnchor;
  if (process.platform !== 'darwin') {
    macOSSelectionAnchor = null;
    return null;
  }

  const binaryPath = app.isPackaged
    ? join(
        process.resourcesPath,
        'app.asar.unpacked',
        'build',
        'native',
        'macos-selection-anchor.node',
      )
    : join(app.getAppPath(), 'build', 'native', 'macos-selection-anchor.node');

  try {
    macOSSelectionAnchor = require(binaryPath) as MacOSSelectionAnchor;
  } catch (error) {
    console.warn('Selection anchor is unavailable:', error);
    macOSSelectionAnchor = null;
  }
  return macOSSelectionAnchor;
}

export function getSelectionBounds(): SelectionBounds | null {
  const bounds = getMacOSSelectionAnchor()?.getSelectionBounds();
  if (
    !bounds ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return null;
  }

  return bounds;
}
