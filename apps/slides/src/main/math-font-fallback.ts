/** Keep measurement and drawing on one font when a text face lacks mathematical symbols. */
export function mathFallbackFamily(
  text: string,
  hasGlyph: (text: string) => boolean,
  covers: (family: string, text: string) => boolean,
): string | undefined {
  const symbols = [...text].filter((ch) => /[\u2190-\u22ff\u27c0-\u27ef\u2980-\u2aff]/u.test(ch))
  if (!symbols.length || symbols.every(hasGlyph)) return undefined
  for (const family of [
    'Cambria Math',
    'STIX Two Math',
    'Segoe UI Symbol',
    'Apple Symbols',
    'Arial',
  ]) {
    if ([...text].every((ch) => covers(family, ch))) return family
  }
  return undefined
}
