import { describe, it, expect } from 'vitest';

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const makeId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
};

const ID_RE = /^[A-Za-z0-9]{6,32}$/;

describe('room-panel utilities', () => {
  it('makeId generates valid 10-character IDs', () => {
    const id = makeId();
    expect(id).toMatch(/^[A-Za-z0-9]{10}$/);
  });

  it('makeId uses only the allowed alphabet', () => {
    const id = makeId();
    for (const char of id) {
      expect(ID_ALPHABET.includes(char)).toBe(true);
    }
  });

  it('ID_RE validates correct IDs', () => {
    expect(ID_RE.test(makeId())).toBe(true);
    expect(ID_RE.test('abc123xyz9')).toBe(true); // min length 6
    expect(ID_RE.test('abcdefghij1234567890123456')).toBe(true); // max length 32
  });

  it('ID_RE rejects invalid IDs', () => {
    expect(ID_RE.test('abc12')).toBe(false); // too short (5 chars)
    expect(ID_RE.test('abcdefghijklmnopqrstuvwxyz1234567')).toBe(false); // too long (33 chars)
    expect(ID_RE.test('abc-def')).toBe(false); // invalid chars
    expect(ID_RE.test('')).toBe(false); // empty
    expect(ID_RE.test('garbage!@#')).toBe(false); // symbols
  });
});
