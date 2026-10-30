import { describe, expect, it } from 'vitest'
import { mathFallbackFamily } from '../src/main/math-font-fallback'

describe('missing mathematical glyphs', () => {
  it('uses a math face for membership instead of measuring a missing glyph', () => {
    expect(
      mathFallbackFamily(
        '∈',
        () => false,
        (family, ch) => family === 'Cambria Math' && ch === '∈',
      ),
    ).toBe('Cambria Math')
  })
  it('keeps symbols already present in the requested face', () => {
    expect(
      mathFallbackFamily(
        '∈',
        () => true,
        () => true,
      ),
    ).toBeUndefined()
  })
  it('uses the macOS symbol face when Office math fonts are absent', () => {
    expect(
      mathFallbackFamily(
        '∈',
        () => false,
        (family) => family === 'Apple Symbols',
      ),
    ).toBe('Apple Symbols')
  })
  it('requires coverage of the entire token and leaves ordinary text alone', () => {
    expect(
      mathFallbackFamily(
        'x∈S',
        () => false,
        (_family, ch) => ch === '∈',
      ),
    ).toBeUndefined()
    expect(
      mathFallbackFamily(
        'Periods',
        () => false,
        () => true,
      ),
    ).toBeUndefined()
  })
})
