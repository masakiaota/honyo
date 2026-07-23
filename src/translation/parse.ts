// Pure, electron-free helpers for the model-emitted language header.
//
// The translation prompt asks the model to make the FIRST line of its output a
// machine-readable header of the form `[<source> -> <target>]` (a Unicode arrow
// `→` is also accepted), with the translation itself starting on line 2. These
// helpers strip that header and never lose translation text to a malformed one.

export interface ParsedTranslation {
  translation: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}

// First line only: `[Source -> Target]` / `[Source → Target]` (tolerant of
// surrounding whitespace). The capture groups are non-greedy so the LAST arrow
// on the line is not required — a single arrow separates the two names.
const HEADER_RE = /^\[(.+?)\s*(?:->|→)\s*(.+?)\]\s*$/;

/**
 * Split a raw model output into its language header (if any) and the
 * translation body. If the first line is not a valid header, the ENTIRE output
 * is treated as the translation and the languages are left undefined.
 */
export function parseTranslationOutput(raw: string): ParsedTranslation {
  // The model may emit stray whitespace/newlines before the header; the header
  // is still "the first line" for our purposes.
  const stripped = raw.replace(/^\s+/, '');
  const newlineIndex = stripped.indexOf('\n');
  const firstLine = newlineIndex === -1 ? stripped : stripped.slice(0, newlineIndex);
  const match = HEADER_RE.exec(firstLine.trim());

  const sourceLanguage = match?.[1]?.trim();
  const targetLanguage = match?.[2]?.trim();
  if (!sourceLanguage || !targetLanguage) {
    return { translation: raw };
  }

  // Everything after the first newline is the translation body. Drop leading
  // newlines the model may have added after the header.
  const body = newlineIndex === -1 ? '' : stripped.slice(newlineIndex + 1).replace(/^\n+/, '');

  return { translation: body, sourceLanguage, targetLanguage };
}

/**
 * Streaming helper: decide whether enough of `raw` has arrived to resolve the
 * header. Returns true once we've seen a newline, or the buffer is clearly not a
 * header (doesn't start with '['), or it has grown past `maxHeaderChars` without
 * a newline (a runaway/absent header). While this returns false the caller
 * should keep buffering and not emit anything yet.
 */
export function isHeaderResolvable(raw: string, maxHeaderChars = 100): boolean {
  // Ignore leading whitespace the model may emit before the header.
  const stripped = raw.replace(/^\s+/, '');
  if (stripped.length === 0) return false;
  if (stripped.includes('\n')) return true;
  if (stripped[0] !== '[') return true;
  return stripped.length > maxHeaderChars;
}
