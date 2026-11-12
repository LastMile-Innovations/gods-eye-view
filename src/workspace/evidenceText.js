/** Decode without stripping a retained UTF-8 BOM. Textareas normalize CRLF and CR to LF. */
export const decodeEvidenceText = (bytes) =>
  new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
/** Map textarea UTF-16 positions back to exact original UTF-8 boundaries. */
export function evidenceSelectionBytes(bytes, start, end) {
  const text = decodeEvidenceText(bytes),
    positions = [0];
  for (let i = 0; i < text.length;) {
    i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1;
    positions.push(i);
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end >= positions.length
  )
    throw new Error('INVALID');
  const boundaries = [positions[start], positions[end]];
  for (const i of boundaries) {
    if (
      i > 0 &&
      i < text.length &&
      /[\uDC00-\uDFFF]/u.test(text[i]) &&
      /[\uD800-\uDBFF]/u.test(text[i - 1])
    )
      throw new Error('INVALID');
  }
  return boundaries.map(
    (i) => new TextEncoder().encode(text.slice(0, i)).length,
  );
}
