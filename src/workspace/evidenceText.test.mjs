import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEvidenceText, evidenceSelectionBytes } from './evidenceText.js';
const bytes = (s) => new TextEncoder().encode(s);
test('textarea selection after CRLF and lone CR maps to original byte offsets', () => {
  const source = bytes('é\r\nSECRET\rEND');
  // The textarea value is "é\nSECRET\nEND"; SECRET occupies UTF-16 [2,8).
  assert.deepEqual(evidenceSelectionBytes(source, 2, 8), [4, 10]);
  assert.deepEqual(evidenceSelectionBytes(source, 9, 12), [11, 14]);
});
test('UTF-8 BOM is retained and emoji selection counts original code units and bytes', () => {
  const source = bytes('\ufeffé\r\n😀 SECRET\r\n');
  assert.equal(decodeEvidenceText(source).charCodeAt(0), 0xfeff);
  // textarea is BOM + é + LF + surrogate pair + space + SECRET + LF.
  assert.deepEqual(evidenceSelectionBytes(source, 6, 12), [12, 18]);
});
test('selection boundaries refuse invalid indices, partial surrogate and non-UTF8 source', () => {
  const source = bytes('😀 yes');
  for (const [start, end] of [
    [0, 1],
    [1, 2],
    [2, 2],
    [-1, 2],
    [2, 99],
    [0.5, 2],
  ])
    assert.throws(() => evidenceSelectionBytes(source, start, end));
  assert.throws(() => decodeEvidenceText(new Uint8Array([0xff])));
});
